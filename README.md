# Meridian

**Robot otomatis pengelola likuiditas Meteora DLMM di Solana, pakai AI (LLM).**

---

## 📖 Buat Pemula: Apa Ini?

**Meridian** adalah robot trading otomatis khusus buat yang mau jadi **Liquidity Provider (LP)** di blockchain **Solana**.

### Apa itu Liquidity Provider (LP)?
Bayangin kamu punya dua jenis uang: uang asli (SOL) dan uang digital (token kayak USDC, BONK, dll). Kamu naruh keduanya ke dalam "kolam" (pool) di bursa terdesentralisasi. Orang-orang yang mau tukar uang mereka pakai kolam ini, dan kamu dapet **fee** (biaya transaksi) sebagai imbalan.

### Apa itu DLMM?
DLMM = **Dynamic Liquidity Market Maker**. Ini teknologi dari **Meteora** yang bikin kolam likuiditas jadi lebih efisien:
- Kamu bisa pilih range harga tertentu (misal: harga token X antara $1-$2)
- Kalau harga token ada di range kamu, kamu dapet fee
- Kalau harga keluar dari range kamu, posisi kamu "out of range" → gak dapet fee lagi

### Kenapa Butuh Robot Otomatis?
Jadi LP secara manual itu **ribet dan capek**:
- Harus pantau harga token 24/7
- Harus hitung fee/TVL, volume, organic score (transaksi asli atau bot)
- Harus putusin kapan buka posisi, kapan tutup, kapan pindah ke pool lain
- Salah range = duit nganggur, rugi, atau kena impermanent loss

**Meridian** ngelakuin semua itu otomatis pakai **AI (LLM)**:
1. **Screening** — tiap 5 menit, AI nyari pool terbaik di seluruh Meteora
2. **Deploy** — kalau nemu pool bagus, AI otomatis naruh duitmu ke situ
3. **Monitor** — tiap 30 detik, AI cek apakah posisimu masih untung, masih in-range, atau harus ditutup
4. **Act** — AI bisa klaim fee, tutup posisi, atau pindah ke pool lain

### Konsep ReAct Agent
Meridian pakai pola **ReAct** (Reason + Act):
- AI "berpikir" dulu lihat data (harga, fee, PnL, range)
- AI pilih "tool" yang mau dipakai (cek posisi, deploy, tutup, dll)
- AI eksekusi, lalu evaluasi hasilnya
- Proses ini berulang tiap siklus

### Screening vs Management
Ada 2 agent yang jalan paralel:
| Agent | Interval | Tugas |
|---|---|---|
| **Hunter** (Screening) | Tiap 5 menit | Cari pool baru yang potensial |
| **Healer** (Management) | Tiap 30 detik | Pantau & kelola posisi yang udah terbuka |

---

## Apa yang Bisa Dilakukan

- **Screening pool** — terus-terusan scan pool Meteora DLMM berdasarkan threshold yang bisa diatur (fee/TVL ratio, organic score, jumlah holder, market cap, bin step, dll) buat nemu peluang berkualitas
- **Kelola posisi** — buka, pantau, dan tutup posisi LP otomatis; putusin STAY (tahan), CLOSE (tutup), atau REDEPLOY (pindah) berdasarkan data PnL, yield, dan range real-time
- **Klaim fee** — lacak fee yang belum diklaim per posisi dan klaim kalau sudah mencapai threshold
- **Belajar dari performa** — pelajari top LP di pool target, simpan pelajaran terstruktur, dan sesuaikan threshold screening berdasarkan riwayat posisi yang ditutup
- **Pantau wallet apa aja** — cek posisi DLMM terbuka dan top LP untuk wallet Solana atau alamat pool mana pun
- **Chat Telegram** — chat penuh via Telegram, plus laporan siklus dan alert out-of-range otomatis

---

## Cara Kerja

Meridian jalan pakai **loop ReAct agent** — tiap siklus LLM mikir dari data live, panggil tool, dan bertindak. Dua agent spesialis jalan di jadwal cron terpisah:

| Agent | Interval Default | Peran |
|---|---|---|
| **Hunter Alpha** | Tiap 30 menit | Screening pool — cari dan deploy ke kandidat terbaik |
| **Healer Alpha** | Tiap 10 menit | Kelola posisi — evaluasi tiap posisi terbuka dan bertindak |

Satu **health check** ketiga jalan tiap jam buat rangkum status portofolio.

**Sumber data yang dipakai agent:**
- `@meteora-ag/dlmm` SDK — data posisi on-chain, active bin, transaksi deploy/tutup
- Meteora DLMM PnL API — yield posisi, akumulasi fee, PnL
- Wallet RPC — saldo SOL dan token
- Pool screening API — fee/TVL ratio, volume, organic score, jumlah holder

Agent dijalankan pakai **OpenRouter** dan bisa diganti ke model lain yang kompatibel dengan ubah `managementModel` / `screeningModel` di `user-config.json`.

---

## Persyaratan

- Node.js 18+
- API key LLM (OpenRouter **atau** OpenCode Go)
- Wallet Solana (private key base58)
- Token bot Telegram (opsional, buat notifikasi)

---

## Instalasi

**1. Clone repo**

```bash
git clone <url-repo>
cd dlmm-agent
```

**2. Install dependencies**

```bash
npm install
```

**3. Buat `.env`**

```env
# Provider LLM (pilih salah satu)
OPENROUTER_API_KEY=sk-or-...               # buat OpenRouter
LLM_BASE_URL=https://opencode.ai/zen/go/v1 # buat OpenCode Go
LLM_API_KEY=sk-...                         # buat OpenCode Go

WALLET_PRIVATE_KEY=private_key_base58_kamu
HELIUS_API_KEY=api_key_helius_kamu         # buat cek saldo wallet
TELEGRAM_BOT_TOKEN=123456:ABC...           # opsional
LPAGENT_API_KEY=lpagent_...                # opsional, buat study_top_lpers
DRY_RUN=true                               # ubah ke false buat trading live
```

> **RPC**: defaultnya `https://pump.helius-rpc.com` (gak perlu key). Ganti pakai `RPC_URL=` di `.env`.
> **OpenCode Go**: isi `LLM_BASE_URL` dan `LLM_API_KEY`, gak usah pakai `OPENROUTER_API_KEY`. Support model kayak `kimi-k2.6`.

Opsi enkripsi `.env`:

```bash
cp .env .env.raw
printf "ganti-dengan-key-panjang-lokal\n" > .envrypt
npm run env:encrypt
```

Meridian otomatis load nilai terenkripsi gaya envrypt. Simpan `.env.raw` dan `.envrypt` di lokal; keduanya di-gitignore.

**4. Copy contoh config**

```bash
cp user-config.example.json user-config.json
```

**5. Jalankan**

```bash
# Dry run (aman — gak ada transaksi on-chain)
npm run dev

# Mode live (pakai PM2 buat produksi)
pm2 start index.js --name meridian
```

> ⚠️ `npm run dev` paksa `DRY_RUN=true` lewat script package.json. Buat trading live, jalankan `node index.js` langsung atau pakai PM2.

Saat startup, Meridian ambil saldo wallet, posisi terbuka, dan kandidat pool terbaik, lalu mulai siklus otomatis langsung.

---

## Patch Custom Fork (Branch Experimental)

Fork ini (branch `develop`) include patch stabilitas dan tuning yang diterapkan di atas upstream `experimental`:

### Patch Kode

| File | Patch | Alasan |
|---|---|---|
| `agent.js` | Skip parameter `tool_choice` kalau `LLM_BASE_URL` mengandung `opencode.ai` | OpenCode Go return 400 di field `tool_choice` yang gak didukung |
| `agent.js` | Tambah counter `emptyStreak` — abort setelah 3 respons LLM kosong berturut-turut | Cegah infinite loop kalau LLM return blank / tanpa tool |
| `index.js` | Tambah rate limiter buat command Telegram `/status` — 1x per menit per chat | Cegah spam & kurangi biaya API LLM |
| `index.js` | PnL poller dinamis: recursive setTimeout (bukan setInterval) + flag `_pnlHasOpenPositions`, interval & cooldown adaptif. Force-fetch API cuma tiap `fastPnlCooldownSec`, pake cache di antara tick biar gak kena rate limit | Deteksi stop loss lebih cepat saat ada posisi terbuka; hemat API saat idle |
| `config.js` + `executor.js` | Tambah field `fastPnlCooldownSec` (default 20) di section schedule | Konfigurasi interval PnL cepat pas ada posisi |
| `index.js` + `config.js` + `executor.js` | Management cycle dinamis: cron jalan tiap menit (`* * * * *`), tapi eksekusi cepet (`fastManagementIntervalMin`, default 1m) kalo ada posisi terbuka, lambat (`managementIntervalMin`) kalo idle. Di-log sebagai `[Mgmt cycle] fast/normal` | Management LLM gak perlu nunggu 3 menit kalo ada posisi; tetap hemat pas idle |

### Rekomendasi Tuning Config

Nilai berikut sudah teruji buat wallet saldo kecil (~0.5–1 SOL):

| Field | Default | Tuned | Keterangan |
|---|---|---|---|
| `deployAmountSol` | `0.5` | `0.1` | Minimum Meteora; sebar modal lebih tipis |
| `maxPositions` | `3` | `2` | Fokus modal, risiko lebih kecil |
| `minSolToOpen` | `0.07` | `0.15` | Reserve buffer buat gas + rebalance |
| `gasReserve` | `0.2` | `0.03` | Diturunkan buat wallet kecil |
|| `managementIntervalMin` | `10` | `3` | Siklus management tiap 3 menit (idle). Cepet ke 1 menit pas ada posisi via `fastManagementIntervalMin` |
|| `screeningIntervalMin` | `30` | `10` | Screening tiap 10 menit |
|| `stopLossPct` | `-50` | `-30` | Potong rugi lebih cepat |
|| `takeProfitPct` | `5` | `10` | Biarkan fee menumpuk lebih lama |
|| `trailingTriggerPct` | `3` | `5` | Mulai trailing di +5% |
|| `trailingDropPct` | `1.5` | `2` | Exit sensitif saat pullback |
| `minFeeActiveTvlRatio` | `0.05` | `0.01` | Lebih banyak pool yang lolos |
| `minFeePerTvl24h` | `7` | `4` | Lebih banyak pool yang lolos |
| `outOfRangeWaitMinutes` | `30` | `15` | Reaksi OOR lebih cepat |
| `positionSizePct` | — | `0.35` | Rasio ukuran posisi |
| `binsBelow` | — | `69` | Range bin DLMM |
| `lpAgentRelayEnabled` | `false` | `false` | Relay Agent Meridian — OFF karena sering timeout & nambah delay 30+ detik. Disable biar langsung scan Meteora lokal (lebih cepet). |
| `useDiscordSignals` | `false` | `true` | Gabung kandidat signal Discord ke pool screening |
| `discordSignalMode` | — | `"merge"` | Tambah signal Discord sebagai kandidat tambahan, bukan override |

---

## Referensi Config

Semua field opsional — default ditampilkan. Edit `user-config.json`.

| Field | Default | Keterangan |
|---|---|---|
| `walletKey` | — | Private key wallet trading (base58) |
| `rpcUrl` | — | URL endpoint RPC Solana |
| `dryRun` | `true` | Simulasi semua transaksi tanpa submit |
| `deployAmountSol` | `0.5` | SOL yang dideploy per posisi baru |
| `maxPositions` | `3` | Maksimum posisi terbuka bersamaan |
| `minSolToOpen` | `0.07` | Saldo SOL minimum wallet sebelum buka posisi baru |
| `managementIntervalMin` | `10` | Seberapa sering agent management jalan (menit) |
| `screeningIntervalMin` | `30` | Seberapa sering agent screening jalan (menit) |
| `fastManagementIntervalMin` | `1` | Interval management cycle kalo ada posisi terbuka (menit). Minimal 1 menit. Otomatis slow ke `managementIntervalMin` saat idle |
| `fastPnlCooldownSec` | `20` | Interval PnL poll + cooldown trigger management saat ada posisi terbuka (detik). Otomatis balik normal (30s poll, managementIntervalMin cooldown) saat semua posisi tutup |
| `managementModel` | `openrouter/healer-alpha` | Model LLM buat kelola posisi |
| `screeningModel` | `openrouter/hunter-alpha` | Model LLM buat screening pool |
| `generalModel` | `openrouter/healer-alpha` | Model LLM buat chat REPL dan `/learn` |
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio (5%) |
| `minTvl` | `10000` | Minimum TVL pool dalam USD |
| `maxTvl` | `150000` | Maksimum TVL pool dalam USD |
| `minOrganic` | `65` | Minimum organic score (0–100) |
| `minHolders` | `500` | Minimum jumlah holder token |
| `timeframe` | `5m` | Timeframe candle yang dipakai screening |
| `category` | `trending` | Filter kategori pool buat screening |
| `takeProfitPct` | `5` | Tutup posisi saat PnL mencapai threshold % ini |
| `outOfRangeWaitMinutes` | `30` | Menit posisi boleh out of range sebelum alert / bertindak |

---

## Command REPL

Setelah startup, prompt interaktif tersedia. Prompt nunjukin countdown live ke siklus management dan screening berikutnya.

```
[manage: 8m 12s | screen: 24m 3s]
>
```

| Command | Keterangan |
|---|---|
| `1`, `2`, `3` ... | Deploy ke pool nomor itu dari daftar kandidat sekarang |
| `auto` | Biarkan agent pilih pool terbaik dan deploy otomatis |
| `/status` | Refresh dan tampilkan saldo wallet dan posisi terbuka |
| `/candidates` | Re-screen dan tampilkan kandidat pool terbaik saat ini |
| `/learn` | Pelajari top LP di semua pool kandidat saat ini dan simpan pelajaran |
| `/learn <alamat_pool>` | Pelajari top LP dari alamat pool tertentu |
| `<alamat_wallet>` | Minta agent cek posisi wallet apa pun atau top LP pool |
| `/thresholds` | Tampilkan threshold screening saat ini dan stat performa posisi tertutup |
| `/evolve` | Trigger penyesuaian threshold dari data performa (butuh 5+ posisi tertutup) |
| `/stop` | Shutdown graceful |
| `<apa aja>` | Chat bebas — tanya agent, minta tindakan, analisa pool |

Chat bebas menyimpan riwayat sesi (10 percakapan terakhir), jadi bisa ngobrol terus: `"gimana pool #2?"`, `"tutup semua posisi"`, `"hari ini udah dapet berapa?"`.

---

## Telegram

**Setup:**

1. Buat bot via [@BotFather](https://t.me/BotFather) dan copy tokennya
2. Tambahin `TELEGRAM_BOT_TOKEN=<token>` ke `.env`
3. Set chat Telegram dan user ID controller yang diizinkan di `.env`

Meridian gak lagi auto-registrasi chat pertama demi keamanan. Kamu harus set:

```env
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<id chat target>
TELEGRAM_ALLOWED_USER_IDS=<id user Telegram yang diizinkan, pisah koma>
```

Catatan keamanan:
- Kalau `TELEGRAM_CHAT_ID` gak di-set, kontrol Telegram masuk diabaikan.
- Kalau chat target grup/supergroup dan `TELEGRAM_ALLOWED_USER_IDS` kosong, kontrol masuk diabaikan.
- Notifikasi tetap ke chat yang dikonfigurasi, tapi command/kontrol dibatasi ke user ID yang diizinkan.

**Notifikasi yang dikirim:**
- Setelah tiap siklus management: laporan agent lengkap (alasan + keputusan)
- Setelah tiap siklus screening: laporan agent lengkap (apa yang ditemukan, deploy atau tidak)
- Saat posisi out of range lewat `outOfRangeWaitMinutes`
- Saat deploy: pair, jumlah, alamat posisi, hash tx
- Saat tutup: pair dan PnL

Kamu juga bisa chat dengan agent via Telegram pakai interface chat bebas yang sama kayak REPL: `"cek wallet 7tB8..."`, `"siapa top LP di pool ABC..."`, `"tutup semua posisi"`, dll. Hanya user ID Telegram yang diizinkan yang bisa kasih command.

---

## Cara Belajar

Meridian mengumpulkan pengetahuan terstruktur di `lessons.json` dengan dua komponen:

### Pelajaran (`/learn`)

Jalankan `/learn` bakal trigger agent buat panggil `study_top_lpers` di tiap pool kandidat top. Ia analisis perilaku on-chain LP terbaik di pool tersebut — durasi tahan, timing masuk/keluar, pola scalping vs holding, win rate — dan simpan 4–8 pelajaran konkret yang bisa ditindaklanjuti. Pola cross-pool ditimbang lebih berat karena lebih bisa digeneralisasi.

Pelajaran tersimpan di-inject ke siklus agent berikutnya sebagai bagian konteks sistem, meningkatkan kualitas keputusan seiring waktu.

### Evolusi Threshold (`/evolve`)

Setelah minimal 5 posisi tertutup, `/evolve` analisis rekor performa (win rate, rata-rata PnL, yield fee) dan sesuaikan threshold screening di `user-config.json`. Perubahan langsung efektif — gak perlu restart. Alasan tiap perubahan ditampilkan ke console.

Pakai `/thresholds` buat lihat nilai saat ini bersama stat performa.

---

## Hive Mind (opsional)

Meridian include sistem kecerdasan kolektif **opt-in** bernama **Hive Mind**. Kalau diaktifkan, agent-mu secara anonim membagikan apa yang dipelajari (pelajaran, hasil deploy, threshold screening) dengan agent meridian lain dan menerima kebijaksanaan kerumunan.

**Apa yang kamu dapat:**
- Konsensus pool dari agent lain — "8 agent deploy di sini, win rate 72%"
- Peringkat strategi — strategi mana yang beneran jalan di semua agent
- Konsensus pola — apa yang jalan di tingkat volatilitas berbeda
- Median threshold — setting screening agent lain udah evolve ke mana

**Apa yang kamu bagikan:**
- Pelajaran dari `lessons.json`
- Hasil deploy dari `pool-memory.json` (alamat pool, strategi, PnL, durasi tahan)
- Threshold screening dari `user-config.json`
- **Alamat wallet, private key, atau saldo SOL gak pernah dikirim**

**Dampak:** 1 panggil API non-blocking per siklus screening (~200ms), 1 POST fire-and-forget saat posisi tutup. Kalau hive down, agent-mu gak ngerasa.

### Setup

**1. Dapatkan token registrasi** dari diskusi Telegram pribadi.

**2. Registrasi agent-mu**

```bash
node -e "import('./hive-mind.js').then(m => m.register('https://meridian-hive-api-production.up.railway.app', 'TOKEN_KAMU'))"
```

Ganti `TOKEN_KAMU` dengan token registrasi dari Telegram.

Ini otomatis simpan kredensial ke `user-config.json`. **Simpan API key yang ditampilkan di terminal** — gak bakal ditampilkan lagi.

**3. Selesai.** Gak perlu restart. Agent-mu bakal sync tiap posisi tutup dan query hive saat screening.

### Matikan

Kosongkan kedua field di `user-config.json`:
```json
{
  "hiveMindUrl": "",
  "hiveMindApiKey": ""
}
```

### Self-hosting

Kamu bisa jalankan hive server sendiri daripada pakai yang publik. Lihat [meridian-hive](https://github.com/fciaf420/meridian-hive) buat source code servernya.

---

## Disclaimer

Software ini disediakan apa adanya, tanpa garansi. Menjalankan robot trading otomatis bawa risiko finansial nyata — kamu bisa kehilangan dana. Selalu mulai dengan `npm run dev` (dry run) buat verifikasi perilaku sebelum go live. Jangan deploy modal lebih besar dari yang kamu sanggup kehilangan. Ini bukan saran finansial.

Penulis tidak bertanggung jawab atas kerugian apapun akibat penggunaan software ini.
