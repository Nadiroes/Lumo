import subprocess, numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
fm.fontManager.addfont('/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf')
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']

def load(path, sr=48000):
    r = subprocess.run(['ffmpeg','-v','error','-i',path,'-ac','1','-ar',str(sr),'-f','f32le','-'], capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32), sr

files = [('upload/rap.mp3','rap.mp3 (nouveau)'), ('download/demo-diffrhythm-reel-nuit-etoiles.mp3','demo-nuit-etoiles (avant)')]
fig, axes = plt.subplots(len(files), 2, figsize=(14, 6.5), constrained_layout=True)

for row,(path,label) in enumerate(files):
    x, sr = load(path)
    dur = len(x)/sr
    # --- spectrogram (0-24kHz), log magnitude ---
    N, hop = 2048, 2048
    wins = range(0, len(x)-N, hop)
    S = np.stack([np.abs(np.fft.rfft(np.hanning(N)*x[i:i+N])) for i in wins]).T
    freqs = np.fft.rfftfreq(N, 1/sr)
    t_axis = np.array(list(wins))/sr + N/2/sr
    db = 20*np.log10(S/ (S.max()+1e-9) + 1e-6)
    ax = axes[row][0]
    im = ax.pcolormesh(t_axis, freqs, db, vmin=-80, vmax=0, cmap='magma', shading='auto')
    ax.set_yscale('symlog', linthresh=1000)
    ax.set_ylim(0, 22000)
    ax.set_title(f'{label} — spectrogramme (0-22 kHz, échelle log)', fontsize=10)
    ax.set_ylabel('Hz' if row==0 else '')
    fig.colorbar(im, ax=ax, fraction=0.03)

    # --- long-term average spectrum, linear freq ---
    ax2 = axes[row][1]
    LS = np.mean(S, axis=1)
    ax2.semilogx(freqs[1:], 20*np.log10(LS[1:]/ (LS.max()+1e-9)))
    ax2.axhline(-40, color='gray', ls='--', lw=0.7)
    for cutoff in [4000, 8000, 12000, 16000]:
        ax2.axvline(cutoff, color='red', ls=':', lw=0.6)
        ax2.text(cutoff, -95, f'{cutoff//1000}k', fontsize=7, color='red')
    ax2.set_xlim(50, 22000); ax2.set_ylim(-100, 0)
    ax2.set_title(f'{label} — spectre moyen', fontsize=10)
    ax2.set_xlabel('Hz')
    # find -40dB cutoff
    mag = 20*np.log10(LS/(LS.max()+1e-9))
    idx = np.where(freqs[1:] > 200)[0]
    cut = next((f for f, m in zip(freqs[1:][idx], mag[idx]) if m < -40), None)
    print(f"{label}: duration={dur:.1f}s, cutoff(-40dB)≈{cut and round(cut)} Hz")

plt.savefig('/tmp/spec_compare.png', dpi=90)
print("saved /tmp/spec_compare.png")
