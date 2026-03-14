---
title: Getting Started with Speech to Text
slug: docs/stt/getting-started
---

With Deepgram’s STT API, you can transcribe both pre-recorded files and real-time streams, choose models optimized for different domains, and integrate transcription directly into your apps for use cases like conversational AI, live captions, and agent assist.

Before you start, consider your use case. Deepgram STT offers three main paths:

**Streaming audio**
<div class="custom-card-layout add-gap">
<CardGroup cols={2}>
  <Card class="clickable-card" title="Real-time, turn-based transcription for voice agents" icon={<Icon icon="fa-duotone fa-bars-staggered" size="8" />}>
    <br/>
    Benefits: Model-integrated end-of-turn detection, configurable turn-taking dynamics
    <br/>
    Examples: Contact center agents, customer support bots, real-time assistants.
    <br/>
    [Get started](/docs/flux/quickstart)
    <br/>
    Currently available for English. For other languages, please use our general use [Streaming API](/docs/live-streaming-audio).
  </Card>
  <Card class="clickable-card" title="Realtime transcription for meetings and events" icon={<Icon icon="fa-duotone fa-waveform-lines" size="8" />}>
    <br/>
    Benefits: Transcripts in real time, larger language availability, can get diarized transcripts
    <br/>
    Examples: Captions, live event transcription, monitoring audio feeds.
    <br/>
    [Get started](/docs/live-streaming-audio)
  </Card>
</CardGroup>
</div>

**Pre-recorded audio**
<div class="custom-card-layout add-gap">
<CardGroup cols={1}>
  <Card class="clickable-card" title="Pre-recorded file transcription" icon={<Icon icon="fa-duotone fa-file-audio" size="8" />}>
    <br/>
    **Benefits:** Simple implementation, broader language availability,  cost efficient
    <br/>
    **Examples:** Transcribing interviews, podcasts, meetings, support calls.
    <br/>
    [Get started](/docs/pre-recorded-audio)
  </Card>
</CardGroup>
</div>

