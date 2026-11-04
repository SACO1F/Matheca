# 自制极简环境音床（无采样、无版权风险）：柔和垫音 + 缓慢钟琴点缀
import argparse
import json
import wave
from pathlib import Path

import numpy as np

p = argparse.ArgumentParser()
p.add_argument("--film", required=True)
p.add_argument("--level", type=float, default=0.16, help="音床相对音量")
a = p.parse_args()

film = Path(a.film)
timings = json.loads((film / "build" / "timings.json").read_text(encoding="utf-8"))
total = timings["total"] + 1.5
sr = 48000
n = int(total * sr)
t = np.arange(n) / sr

pad_notes = [110.0, 164.81, 220.0, 277.18, 329.63]
mix = np.zeros(n)
for i, f in enumerate(pad_notes):
    for det in (1.0, 1.0016, 0.9984):
        freq = f * det
        phase = 2 * np.pi * freq * t + i * 0.7
        amp = 0.10 / (1 + i * 0.55)
        swell = 0.55 + 0.45 * np.sin(2 * np.pi * t / (11 + i) + i)
        voice = (np.sin(phase) + 0.22 * np.sin(2 * phase)) * amp * swell
        pan = 1.0 if det > 1 else 0.72 if det < 1 else 0.85
        mix += voice * pan

# 缓慢的钟琴点缀，落在分镜交界附近
bell_notes = [440.0, 554.37, 659.25, 830.61, 880.0]
for k, shot in enumerate(timings["shots"]):
    if k % 2:
        continue
    start = shot["start"] + 0.25
    idx = int(start * sr)
    dur = int(3.2 * sr)
    if idx + dur > n:
        continue
    f = bell_notes[k % len(bell_notes)]
    lt = np.arange(dur) / sr
    env = np.exp(-lt * 1.7) * (1 - np.exp(-lt * 60))
    seg = (np.sin(2 * np.pi * f * lt) + 0.35 * np.sin(2 * np.pi * f * 2 * lt)) * env * 0.055
    mix[idx : idx + dur] += seg

# 极轻的空气层与整体包络
air = np.random.RandomState(7).randn(n) * 0.006
air = np.convolve(air, np.ones(1200) / 1200, mode="same")
mix += air * (0.6 + 0.4 * np.sin(2 * np.pi * t / 17))
envelope = np.ones(n)
fade_in = int(2.0 * sr)
fade_out = int(3.0 * sr)
envelope[:fade_in] = np.linspace(0, 1, fade_in) ** 2
envelope[-fade_out:] = np.linspace(1, 0, fade_out) ** 1.5
mix *= envelope * a.level
mix = np.clip(mix, -0.9, 0.9)

out = film / "audio" / "bed.wav"
out.parent.mkdir(exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("bed ->", out, f"{total:.1f}s rms={20*np.log10(np.sqrt(np.mean(mix**2))):.1f} dBFS")
