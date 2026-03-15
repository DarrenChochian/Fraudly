const fs = require('fs')
const path = require('path')
const os = require('os')
const ffmpeg = require('fluent-ffmpeg')
const ffmpegPath = require('ffmpeg-static')

ffmpeg.setFfmpegPath(ffmpegPath)

const HIVE_ENDPOINT = 'https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection'

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf8')
  const result = {}
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue
    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

async function convertWebmToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath)
  })
}

function registerHiveVoiceDetectionIpc({ ipcMain, projectRoot }) {
  ipcMain.handle('hive:analyze-audio', async (event, { chunk }) => {
    // Read .env fresh on each request to support hot-reloading keys without restart
    const env = {
      ...readEnvFile(path.join(projectRoot, '.env.example')),
      ...process.env,
      ...readEnvFile(path.join(projectRoot, '.env')),
    }
    const apiKey = String(env.HIVE_API_KEY || '').trim()
    const hiveAudioEnabled = String(env.HIVE_AUDIO_DETECTION_ENABLED || 'false').toLowerCase() === 'true'

    if (!hiveAudioEnabled) {
      console.log('[hive] Audio detection disabled (HIVE_AUDIO_DETECTION_ENABLED=false)')
      return { ok: false, error: 'Audio detection disabled', disabled: true }
    }

    if (!apiKey) {
      return { ok: false, error: 'HIVE_API_KEY is missing from .env' }
    }

    if (!chunk || !chunk.byteLength) {
      return { ok: false, error: 'No audio data provided' }
    }

    const tmpDir = os.tmpdir()
    const tmpWebmFile = path.join(tmpDir, `hive-segment-${Date.now()}.webm`)
    const tmpMp3File = path.join(tmpDir, `hive-segment-${Date.now()}.mp3`)

    try {
      // Save the webm chunk
      const buffer = Buffer.from(chunk)
      fs.writeFileSync(tmpWebmFile, buffer)

      const webmSizeKB = (buffer.length / 1024).toFixed(2)
      console.log(`[hive] Converting audio chunk: ${webmSizeKB} KB (webm → mp3)`)

      // Convert webm to mp3
      try {
        await convertWebmToMp3(tmpWebmFile, tmpMp3File)
        console.log(`[hive] Conversion complete`)
      } catch (conversionError) {
        console.error('[hive] Audio conversion failed:', conversionError)
        return { ok: false, error: 'Failed to convert audio to mp3' }
      }

      // Read the converted mp3 file
      const mp3Buffer = fs.readFileSync(tmpMp3File)
      const mp3SizeKB = (mp3Buffer.length / 1024).toFixed(2)
      console.log(`[hive] MP3 size: ${mp3SizeKB} KB`)

      // Check file size (V3 has 20MB limit for base64)
      if (mp3Buffer.length > 20 * 1024 * 1024) {
        console.warn(`[hive] MP3 file too large: ${mp3SizeKB} KB (max 20MB)`)
        return { ok: false, error: 'Audio file exceeds 20MB limit' }
      }

      // Send as mp3 base64
      const base64Audio = mp3Buffer.toString('base64')
      const mediaBase64 = `data:audio/mpeg;base64,${base64Audio}`

      console.log(`[hive] Sending as audio/mpeg (${mp3SizeKB} KB)`)

      const response = await fetch(HIVE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: [{ media_base64: mediaBase64 }],
        }),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        console.error(`[hive] API error ${response.status}: ${text}`)
        console.error(`[hive] Request details - MP3 size: ${mp3SizeKB} KB`)
        return { ok: false, error: `Hive API error: ${response.status}` }
      }

      const data = await response.json()
      console.log(`[hive] API response received, processing...`)

      let aiScore = null
      let label = 'unknown'

      try {
        // V3 Deepfake API response format: output[0].classes[]
        // For audio/video files, it returns 'ai_generated_audio' class
        const outputs = data?.output || []
        if (outputs.length > 0) {
          const classes = outputs[0]?.classes || []
          
          // Try ai_generated_audio first (for audio in video/audio files)
          for (const cls of classes) {
            if (cls.class === 'ai_generated_audio') {
              aiScore = cls.value
              break
            }
          }
          
          // Fallback to ai_generated (for visual content)
          if (aiScore === null) {
            for (const cls of classes) {
              if (cls.class === 'ai_generated') {
                aiScore = cls.value
                break
              }
            }
          }
        }

        if (aiScore !== null) {
          if (aiScore >= 0.9) label = 'ai_generated'
          else if (aiScore >= 0.5) label = 'uncertain'
          else label = 'not_ai_generated'
        }
      } catch (parseErr) {
        console.error('[hive] Failed to parse response:', parseErr)
      }

      if (aiScore === null) {
        console.log('[hive] Could not extract score. Raw response:', JSON.stringify(data, null, 2).slice(0, 1000))
      }
      console.log(`[hive] Detection result: score=${aiScore}, label=${label}`)

      return {
        ok: true,
        score: aiScore,
        label,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Hive detection failed'
      console.error('[hive] Detection error:', error)
      return { ok: false, error: message }
    } finally {
      try {
        if (fs.existsSync(tmpWebmFile)) fs.unlinkSync(tmpWebmFile)
        if (fs.existsSync(tmpMp3File)) fs.unlinkSync(tmpMp3File)
      } catch {
        // Ignore cleanup errors.
      }
    }
  })
}

module.exports = { registerHiveVoiceDetectionIpc }
