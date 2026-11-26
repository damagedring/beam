export function createScanAudio(browser, getStorage) {
  let audio;
  function enabled() {
    try { return getStorage().getItem('beam.scanSound') !== 'off'; } catch { return true; }
  }
  function setEnabled(value) {
    try { getStorage().setItem('beam.scanSound', value ? 'on' : 'off'); } catch {}
    if (value) play('accepted');
  }
  function play(outcome) {
    if (!enabled()) return;
    try {
      const Audio = browser.AudioContext || browser.webkitAudioContext;
      if (!Audio) return;
      audio ??= new Audio();
      const emit = () => {
        const notes = outcome === 'accepted' ? [900] : outcome === 'excess' ? [540, 330] : [480, 670];
        for (const [index, pitch] of notes.entries()) {
          const at = audio.currentTime + index * .09;
          const osc = audio.createOscillator(), gain = audio.createGain();
          osc.frequency.value = pitch;
          gain.gain.setValueAtTime(.001, at);
          gain.gain.exponentialRampToValueAtTime(.085, at + .01);
          gain.gain.exponentialRampToValueAtTime(.001, at + .075);
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start(at);
          osc.stop(at + .08);
          osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        }
      };
      if (audio.state === 'running') emit();
      else void audio.resume().then(emit, () => {});
    } catch { /* Audio is optional after scan recording. */ }
  }
  return { enabled, setEnabled, play };
}
