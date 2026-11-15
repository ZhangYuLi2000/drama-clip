# -*- coding: utf-8 -*-
"""开发期一次性工具：从已验证的 Python 版 cliptrace 导出黄金基准数据。

运行时（Electron/TS 引擎）不依赖 Python；本脚本只在开发机上跑，
产物提交进 test/golden/replica/ 作为 TS 移植的数值对齐门禁（G1/G2/G4）。

用法:
  & 'C:\\Users\\raolong\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe' `
    E:\\drama_work\\scripts\\replica-golden\\export_golden.py
"""
import csv
import json
import os
import shutil
import sys

import numpy as np

sys.path.insert(0, r"E:\dsh_tmp\cliptrace")
from cliptrace import media, fingerprint as fp, indexer, rebuild as rb  # noqa: E402

# 与 TS 运行时同一套二进制（ffmpeg-static / ffprobe-static），保证黄金基准自洽。
# 注意：E:\dsh_tmp 的 vendor ffmpeg 被本机策略限制，不能写 E:\drama_work，勿用。
FF = r"E:\drama_work\node_modules\ffmpeg-static\ffmpeg.exe"
FPROBE = r"E:\drama_work\node_modules\ffprobe-static\bin\win32\x64\ffprobe.exe"
OUT = r"E:\drama_work\test\golden\replica"
EPS = r"E:\dsh_tmp\cliptrace\demo_out\test_data"
CLIP = r"C:\Users\raolong\Downloads\下载.mp4"
REAL_INDEX = r"E:\dsh_tmp\cliptrace\real_test\index"
NEWCLIP = r"E:\dsh_tmp\cliptrace\real_test\newclip"

os.makedirs(OUT, exist_ok=True)


def save_raw(name, arr):
    np.ascontiguousarray(arr).tofile(os.path.join(OUT, name))


def save_json(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def main():
    # ---- 1. 真实解码帧（64x64 灰度），G1 的输入 ----
    ep_files = [os.path.join(EPS, f"被抓住的秘密 {i:03d}.mp4") for i in (1, 2, 3)]
    wins = [(0, 10), (500, 510)]
    frames_list, meta_src = [], []
    for p in ep_files:
        fr, fi = media.decode_windows(p, wins, 64, 64, FF, workdir=OUT)
        frames_list.append(fr)
        meta_src.append({"path": p, "indices": fi.tolist()})
    ep_frames = np.concatenate(frames_list)
    save_raw("frames_ep.raw", ep_frames)
    save_json("frames_ep.json", {"n": int(ep_frames.shape[0]), "h": 64, "w": 64,
                                 "sources": meta_src})

    clip_wins = [(0, 15), (1500, 1515), (3000, 3015), (4400, 4415)]
    clip_frames, clip_fi = media.decode_windows(CLIP, clip_wins, 64, 64, FF, workdir=OUT)
    save_raw("frames_clip.raw", clip_frames)
    save_json("frames_clip.json", {"n": int(clip_frames.shape[0]), "h": 64, "w": 64,
                                   "clip": CLIP, "indices": clip_fi.tolist()})
    print(f"frames: ep={ep_frames.shape[0]} clip={clip_frames.shape[0]}")

    # ---- 2. 指纹 / 镜像变体，G1 ----
    save_raw("desc_ep.f32", fp.describe(ep_frames))
    save_raw("desc_clip.f32", fp.describe(clip_frames))
    save_raw("variants_ep.f32", fp.describe_variants(ep_frames))
    save_raw("variants_clip.f32", fp.describe_variants(clip_frames))

    # ---- 3. 块权重（4 种遮罩配置），G1 ----
    cfgs = {
        "default": dict(mask_bottom=0.25, mask_top=0.0),
        "sampleB": dict(mask_bottom=0.28, mask_top=0.08),
        "band": dict(mask_bottom=0.25, mask_top=0.0, band=(0.63, 0.78)),
        "combo": dict(mask_bottom=0.28, mask_top=0.08, band=(0.63, 0.78)),
    }
    save_json("weights.json", {k: fp.block_weights(**v).tolist() for k, v in cfgs.items()})

    # ---- 4. prepare_verify 高通 NCC 向量，G1 ----
    for tag, frames in (("ep", ep_frames), ("clip", clip_frames)):
        for cname, c in cfgs.items():
            v = fp.prepare_verify(frames, c["mask_bottom"], c["mask_top"], band=c.get("band"))
            save_raw(f"verify_{tag}_{cname}.f32", v)
            save_json(f"verify_{tag}_{cname}.json", {"n": int(v.shape[0]), "m": int(v.shape[1])})

    # ---- 5. band_scores 用例，G1 ----
    qv = fp.prepare_verify(clip_frames, 0.25, 0.0)[:16]
    rv = fp.prepare_verify(ep_frames, 0.25, 0.0)
    rng = np.random.default_rng(7)
    pos = rng.integers(0, rv.shape[0], size=(16, 8)).astype(np.int64)
    valid = rng.random((16, 8)) > 0.2
    sc = fp.band_scores(qv, rv, pos, valid)
    save_raw("bandscores_pos.i32", pos.astype(np.int32))
    save_raw("bandscores_valid.u8", valid.astype(np.uint8))
    save_raw("bandscores_sc.f32", sc)
    save_json("bandscores.json", {"nq": 16, "kk": 8, "nr": int(rv.shape[0]),
                                  "m": int(qv.shape[1])})

    # ---- 6. 迷你索引（3 集），G2 ----
    mini_py = os.path.join(OUT, "_mini_py")
    idx = indexer.build_index(ep_files, mini_py, index_fps=8.0, ffmpeg=FF,
                              ffprobe=FPROBE, workers=2)
    mini = os.path.join(OUT, "mini_index")
    os.makedirs(mini, exist_ok=True)
    for e in idx.episodes:
        base = os.path.join(mini, e.eid)
        save_raw(os.path.relpath(base + ".desc.f32", OUT), e.desc)
        e.frame_idx.astype(np.int32).tofile(base + ".fidx.i32")
        save_json(os.path.relpath(base + ".json", OUT),
                  {"eid": e.eid, "name": e.name, "path": e.path, "step": e.step,
                   "nb_frames": e.info.nb_frames, "fps": e.info.fps,
                   "width": e.info.width, "height": e.info.height,
                   "ni": int(e.desc.shape[0]), "nf": int(e.desc.shape[1])})
    shutil.rmtree(mini_py, ignore_errors=True)

    # ---- 7. topk 检索基准（查询=切片帧，k=4，两种权重），G2 ----
    q = fp.describe(clip_frames)
    for cname in ("default", "sampleB"):
        weights = fp.block_weights(**cfgs[cname])
        for e in idx.episodes:
            d, r, v = fp.topk(q, e.desc, weights, 4, chunk=128)
            base = os.path.join(mini, f"{e.eid}.topk_{cname}")
            d.astype(np.float32).tofile(base + ".d.f32")
            r.astype(np.int32).tofile(base + ".r.i32")
            v.astype(np.uint8).tofile(base + ".v.u8")
    print("mini index + topk golden done")

    # ---- 8. M2 预备：溯源表 / EDL 黄金（despike 与 no-despike）----
    shutil.copy(os.path.join(NEWCLIP, "frames", "frame_origins.csv"),
                os.path.join(OUT, "trace_origins.csv"))
    shutil.copy(os.path.join(NEWCLIP, "recut_refined", "recut_edl.csv"),
                os.path.join(OUT, "edl_refined.csv"))
    full = indexer.load_index(REAL_INDEX)
    ep_max = {e.eid: e.info.nb_frames for e in full.episodes}
    save_json("ep_max.json", ep_max)
    trace = rb.load_trace(os.path.join(OUT, "trace_origins.csv"), "origins")

    def dump_edl(name, edl):
        cols = ["segment_id", "clip_in", "clip_out", "clip_frames", "episode",
                "src_in", "src_out", "src_frames", "kind", "flip"]
        with open(os.path.join(OUT, name), "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for s in edl:
                w.writerow({k: s.get(k, "") for k in cols})

    dump_edl("edl_despike.csv", rb.build_edl(trace, len(trace), despike=True, ep_max=ep_max))
    dump_edl("edl_nodespike.csv", rb.build_edl(trace, len(trace), despike=False, ep_max=ep_max))
    print("EDL golden done")
    print("ALL GOLDEN EXPORTED ->", OUT)


if __name__ == "__main__":
    main()
