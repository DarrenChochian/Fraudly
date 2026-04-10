export const PINK_LIGHT = '#ff8ec8'
export const BORDER_PINK = 'rgba(255, 132, 198, 0.32)'
export const BG_PANEL = 'rgba(10, 12, 18, 0.82)'
export const GLASS_BACKDROP = 'blur(18px) saturate(150%)'
export const NEUTRAL_PANEL_FILL =
  'radial-gradient(180% 140% at 45% -25%, rgba(82, 94, 122, 0.15) 0%, rgba(18, 22, 33, 0.9) 52%, rgba(7, 9, 15, 0.97) 100%)'
export const NEUTRAL_PANEL_HEADER =
  'linear-gradient(180deg, rgba(98, 112, 143, 0.16), rgba(22, 27, 39, 0.84) 68%, rgba(9, 12, 19, 0.94))'
export const NEUTRAL_PANEL_SHADOW =
  '0 0 0 1px rgba(116, 128, 158, 0.16), inset 0 -1.2px rgba(5, 7, 12, 0.92), inset 0 0.7px rgba(154, 167, 198, 0.2), 0 20px 44px rgba(0, 0, 0, 0.54), 0 8px 22px rgba(2, 4, 10, 0.56)'
export const NEUTRAL_CARD_FILL =
  'radial-gradient(170% 130% at 46% -20%, rgba(124, 138, 172, 0.14) 0%, rgba(25, 30, 43, 0.82) 56%, rgba(8, 11, 17, 0.95) 100%)'
export const PINK_GLOSS_FILL =
  'radial-gradient(179.05% 132.83% at 46.18% -23.44%, #ff9bd8 0%, #ff5aa8 35%, #bb2f7a 72%, #6b1b4a 100%)'
export const PINK_GLOSS_FILL_DARK =
  'radial-gradient(170% 135% at 46% -24%, rgba(255, 176, 224, 0.34) 0%, rgba(155, 44, 109, 0.58) 42%, rgba(23, 9, 28, 0.92) 100%)'
export const PINK_GLOSS_SHADOW =
  '0 0 0 0.7px rgba(255, 133, 199, 0.95), inset 0 -1.35px rgba(93, 10, 57, 0.9), inset 0 0.7px rgba(255, 205, 233, 0.8), 0 9px 28px rgba(134, 25, 90, 0.56), 0 30px 45px rgba(0, 0, 0, 0.28)'
export const USER_BUBBLE_FILL = PINK_GLOSS_FILL
export const USER_BUBBLE_SHADOW = PINK_GLOSS_SHADOW

export const SHOW_TRANSCRIPTION_DEBUG = false
export const AUDIO_CHUNK_MS = 250
// Prioritize formats supported by Hive API: .mp3, .m4a, .wav
// Note: Browser MediaRecorder support is limited. Most browsers support webm/ogg.
// We'll keep webm but update the backend to convert or use what's available.
export const AUDIO_MIME_CANDIDATES = [
  'audio/mp4',           // .m4a format (Safari support)
  'audio/mpeg',          // .mp3 format (limited browser support)
  'audio/wav',           // .wav format (limited browser support)
  'audio/webm;codecs=opus', // Fallback to webm (most common)
  'audio/webm',
  'audio/ogg;codecs=opus'
]

export const BUTTON_WIDTH = 64
export const BUTTON_HEIGHT = 64
