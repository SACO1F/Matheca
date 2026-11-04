import argparse
import json
import re
import subprocess
from pathlib import Path

import edge_tts

p = argparse.ArgumentParser()
p.add_argument("--film", required=True)
p.add_argument("--voice", default=None)
p.add_argument("--tail", type=float, default=1.0, help="每句旁白后的留白秒数")
p.add_argument("--lead", type=float, default=0.35, help="旁白进入前的静默")
a = p.parse_args()

film = Path(a.film)
build = film / "build"
spec = json.loads((build / "narration.json").read_text(encoding="utf-8"))
voice = a.voice or spec["voice"]
rate = spec.get("rate", "+0%")
raw = film / "audio" / "raw"
pad = film / "audio" / "padded"
for d in (raw, pad):
    d.mkdir(parents=True, exist_ok=True)
FF = str(Path("D:/AI/Matheca/.tmp/film-tools/node_modules/ffmpeg-static/ffmpeg.exe"))


def duration(path: Path) -> float:
    out = subprocess.run(
        [FF, "-hide_banner", "-i", str(path)], capture_output=True, text=True
    ).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


plan = []
for line in spec["lines"]:
    mp3 = raw / f"{line['n']:02d}.mp3"
    if not mp3.exists() or mp3.stat().st_size < 1024:
        subprocess.run(
            [
                "python",
                "-m",
                "edge_tts",
                "--voice",
                voice,
                f"--rate={rate}",
                "--text",
                line["text"],
                "--write-media",
                str(mp3),
            ],
            check=True,
        )
    spoken = duration(mp3)
    shot = max(line["min"], round(spoken + a.lead + a.tail, 2))
    wav = pad / f"{line['n']:02d}.wav"
    subprocess.run(
        [
            FF,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(mp3),
            "-af",
            f"adelay={int(a.lead*1000)}|{int(a.lead*1000)},apad",
            "-t",
            f"{shot:.2f}",
            "-ar",
            "48000",
            "-ac",
            "2",
            str(wav),
        ],
        check=True,
    )
    plan.append(
        {
            "n": line["n"],
            "text": line["text"],
            "spoken": round(spoken, 2),
            "duration": round(duration(wav), 2),
            "audio": str(wav),
        }
    )
    print(f"{line['n']:02d}  spoken {spoken:5.2f}  shot {plan[-1]['duration']:5.2f}")

start = 0.0
for item in plan:
    item["start"] = round(start, 2)
    start += item["duration"]
    item["end"] = round(start, 2)
total = round(start, 2)

listfile = film / "audio" / "concat.txt"
listfile.write_text(
    "\n".join(f"file '{Path(i['audio']).as_posix()}'" for i in plan), encoding="utf-8"
)
full = film / "audio" / "narration.wav"
subprocess.run(
    [
        FF, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", str(listfile),
        "-ar", "48000", "-ac", "2", str(full),
    ],
    check=True,
)

srt = []
for i in plan:
    def ts(sec):
        h, rem = divmod(sec, 3600)
        m, s = divmod(rem, 60)
        return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", ",")
    srt.append(f"{i['n']}\n{ts(i['start']+a.lead)} --> {ts(i['end']-a.tail)}\n{i['text']}\n")
(film / "output" / "Matheca-Launch-Film.srt").parent.mkdir(exist_ok=True)
(film / "output" / "Matheca-Launch-Film.srt").write_text("\n".join(srt), encoding="utf-8")

json.dump(
    {"voice": voice, "rate": rate, "total": total, "shots": plan},
    (build / "timings.json").open("w", encoding="utf-8"),
    ensure_ascii=False,
    indent=2,
)
print("total", total, "s ->", full)
