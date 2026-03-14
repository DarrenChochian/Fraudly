***

title: Sample Rate
subtitle: Sample Rate allows you to specify the sample rate of your submitted audio.
slug: docs/sample-rate
----------------------

`sample_rate` *int32*

<div class="flex flex-row gap-2">
  <span class="dg-badge unavailable strike-through">
    <span><Icon icon="file" /> Pre-recorded</span>
  </span>

  <span class="dg-badge">
    <span><Icon icon="waveform-lines" /> Streaming:Nova</span>
  </span>

  <span class="dg-badge">
    <span><Icon icon="stream" />Streaming:Flux</span>
  </span>

  <span class="dg-badge pink">
    <span><Icon icon="language" /> All available languages</span>
  </span>
</div>

## Enable Feature

<Info>
  Sample Rate is required when using the [Encoding](/docs/encoding) feature for non-containerized/raw audio. For containerized audio formats, both `sample_rate` and `encoding` should be omitted.
</Info>

To enable Sample Rate, when you call Deepgram's API, add a `sample_rate` parameter in the query string and set it to the sample rate of your submitted audio.

`sample_rate=SAMPLE_RATE_VALUE`

<CodeGroup>
  ```bash cURL
  curl \
    --request POST \
    --header 'Authorization: Token YOUR_DEEPGRAM_API_KEY' \
    --header 'Content-Type: audio/mp3' \
    --data-binary @youraudio.mp3 \
    --url 'https://api.deepgram.com/v1/listen?sample_rate=8000&encoding=linear16'
  ```
</CodeGroup>

<Warning>
  When submitting audio encoded with the Adaptive Multi-Rate (AMR) codec, you must submit specific Sample Rate values:

  * `amr-nb`: AMR narrowband codec. When using this option, you must specify `sample_rate=8000` (encoding=amr-nb\&sample\_rate=8000).
  * `amr-wb`: AMR wideband codec. When using this option, you must also specify `sample_rate=16000` (encoding=amr-wb\&sample\_rate=16000).
</Warning>


