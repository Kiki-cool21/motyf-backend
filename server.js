const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const Groq = require('groq-sdk');

// Init Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// =========================================
// SAMBUNG KE MONGODB
// =========================================
console.log("Sedang cuba sambung ke MongoDB...");
console.log("URI:", process.env.MONGO_URI ? "✅ Ada URI dalam .env" : "❌ TIADA URI DALAM .env");

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Berjaya sambung ke MongoDB"))
    .catch((err) => {
        console.log("❌ Gagal sambung ke MongoDB. Ralat:");
        console.log(err.message); 
    });

// =========================================
// SCHEMA & MODEL USER
// =========================================
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    kelas: { type: String, required: true },
    password: { type: String, required: true },
    careerDirection: { type: String, default: null },
    careerDirectionAt: { type: Date, default: null },
    careerReasons: { type: [String], default: [] },
    careerReasonsAt: { type: Date, default: null },
    imkCode: { type: String, default: null },
    imkDetail: {                                          // <-- BARU
        top1: String,
        top1_score: Number,
        top2: String,
        top2_score: Number,
        top3: String,
        top3_score: Number
    },
    imkCompletedAt: { type: Date, default: null },
    foundCareerFromExplore: { type: String, default: null },
    foundCareerFromExploreAt: { type: Date, default: null },
    favourites: { type: [String], default: [] },        // ← INI MESTI ADA
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// =========================================
// API ROUTES
// =========================================
app.post('/api/signup', async (req, res) => {
    try {
        const { username, kelas, password } = req.body;
        
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: "Username sudah digunakan." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({ username, kelas, password: hashedPassword });
        await newUser.save();
        
        res.status(201).json({ message: "Akaun berjaya dicipta!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server. Sila cuba lagi." });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: "Akaun tidak dijumpai." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Password tidak betul." });
        }

        res.status(200).json({ 
            message: "Login berjaya!", 
            user: { username: user.username, kelas: user.kelas } 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server. Sila cuba lagi." });
    }
});

// =========================================
// API: SIMPAN HALA TUJU KERJAYA
// =========================================
app.post('/api/career-direction', async (req, res) => {
    try {
        const { username, direction } = req.body;

        // Validasi input
        if (!username || !direction) {
            return res.status(400).json({ message: "Username dan direction diperlukan." });
        }

        if (!['YA', 'TIDAK'].includes(direction)) {
            return res.status(400).json({ message: "Direction tidak sah." });
        }

        // Cari user dan kemaskini field careerDirection
        const user = await User.findOneAndUpdate(
            { username },
            { 
                careerDirection: direction,
                careerDirectionAt: new Date()
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: "Akaun tidak dijumpai." });
        }

        res.status(200).json({ 
            message: "Hala tuju kerjaya berjaya disimpan!",
            user: { 
                username: user.username, 
                careerDirection: user.careerDirection 
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server. Sila cuba lagi." });
    }
});

// =========================================
// API: SIMPAN SEBAB BELUM ADA HALA TUJU
// =========================================
app.post('/api/reason', async (req, res) => {
    try {
        const { username, reasons } = req.body;

        if (!username || !Array.isArray(reasons) || reasons.length === 0) {
            return res.status(400).json({ message: "Username dan sekurang-kurangnya satu sebab diperlukan." });
        }

        const user = await User.findOneAndUpdate(
            { username },
            { 
                careerReasons: reasons,
                careerReasonsAt: new Date()
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: "Akaun tidak dijumpai." });
        }

        res.status(200).json({ 
            message: "Sebab berjaya disimpan!",
            reasons: user.careerReasons
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server. Sila cuba lagi." });
    }
});

// =========================================
// API: UPDATE PROFILE
// =========================================
app.post('/api/update-profile', async (req, res) => {
    try {
        const { username, kelas, currentPassword, newPassword } = req.body;

        if (!username) {
            return res.status(400).json({ message: "Username diperlukan." });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: "Akaun tidak dijumpai." });
        }

        // Kalau nak tukar password
        if (newPassword) {
            // Kena ada current password
            if (!currentPassword) {
                return res.status(400).json({ message: "Sila masukkan password semasa." });
            }

            // Semak current password betul
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({ message: "Password semasa tidak betul." });
            }

            // Validasi password baru
            if (newPassword.length < 6) {
                return res.status(400).json({ message: "Password baru mesti sekurang-kurangnya 6 aksara." });
            }

            // Hash & simpan
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(newPassword, salt);
        }

        // Update kelas (kalau ada)
        if (kelas && kelas.trim()) {
            user.kelas = kelas.trim();
        }

        await user.save();

        res.status(200).json({
            message: "Profil berjaya dikemaskini!",
            user: {
                username: user.username,
                kelas: user.kelas,
                careerDirection: user.careerDirection,
                careerReasons: user.careerReasons,
                exploredCluster: user.exploredCluster,
                imkCode: user.imkCode,
                dreamCareer: user.dreamCareer,
                createdAt: user.createdAt
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server. Sila cuba lagi." });
    }
});
// =========================================
// API: ADMIN LOGIN
// =========================================
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
        res.status(200).json({ 
            message: "Login berjaya!",
            token: "admin-authenticated"
        });
    } else {
        res.status(400).json({ message: "Username atau password salah." });
    }
});

// =========================================
// API: ADMIN STATISTICS
// =========================================
app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = await User.find({ isAdmin: { $ne: true } });
        const total = users.length;
        
        // ===== CAREER QUESTION (AWAL) =====
        const careerYa = users.filter(u => u.careerDirection === 'YA').length;
        const careerTidak = users.filter(u => u.careerDirection === 'TIDAK').length;

        // ===== EXPLORE QUESTION (AKHIR) =====
        const exploreYa = users.filter(u => u.foundCareerFromExplore === 'YA').length;
        const exploreTidak = users.filter(u => u.foundCareerFromExplore === 'TIDAK').length;

        // ===== IMK =====
        const imkCompleted = users.filter(u => u.imkCode).length;

        // ===== HOLLAND CODE =====
        const hollandCount = {};
        users.forEach(u => {
            if (u.imkCode && u.imkCode.length > 0) {
                const first = u.imkCode[0];
                hollandCount[first] = (hollandCount[first] || 0) + 1;
            }
        });

        // ===== REASONS =====
        const reasonCount = {};
        users.forEach(u => {
            if (u.careerReasons && u.careerReasons.length > 0) {
                u.careerReasons.forEach(r => {
                    reasonCount[r] = (reasonCount[r] || 0) + 1;
                });
            }
        });

        res.status(200).json({
            total,
            // Career Question (UNTUK CARTA 1)
            careerYa,
            careerTidak,
            careerYaPercent: total > 0 ? Math.round((careerYa / total) * 100) : 0,
            careerTidakPercent: total > 0 ? Math.round((careerTidak / total) * 100) : 0,
            // Explore Question (UNTUK CARTA 2)
            exploreYa,
            exploreTidak,
            exploreYaPercent: total > 0 ? Math.round((exploreYa / total) * 100) : 0,
            exploreTidakPercent: total > 0 ? Math.round((exploreTidak / total) * 100) : 0,
            // Lain-lain
            imkCompleted,
            hollandCount,
            reasonCount
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server." });
    }
});


// =========================================
// API: ADMIN — SENARAI PELAJAR
// =========================================
app.get('/api/admin/students', async (req, res) => {
    try {
        const users = await User.find({ isAdmin: { $ne: true } })
            .select('username kelas careerDirection imkCode foundCareerFromExplore createdAt')
            .sort({ createdAt: -1 });
        res.status(200).json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server." });
    }
});
// =========================================
// API: AI CAREER CHAT (Groq) — Dengan Retry Logic
// =========================================
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { careerName, careerDetails, messages } = req.body;

        if (!careerName || !messages || !Array.isArray(messages)) {
            return res.status(400).json({ message: "Data tak lengkap." });
        }

        const systemPrompt = `Anda adalah "MoTYF+ Career Assistant", seorang kaunselor kerjaya mesra untuk pelajar sekolah menengah Malaysia.

KONTEKS KERJAYA:
- Nama Kerjaya: ${careerName}
- Deskripsi: ${careerDetails?.description || '-'}
- Gaji Permulaan: ${careerDetails?.salary || '-'}
- Pendidikan: ${careerDetails?.education || '-'}
- Laluan Kerjaya: ${careerDetails?.path || '-'}
- Subjek Fokus SPM: ${careerDetails?.subjects?.join(', ') || '-'}
- Kemahiran Utama: ${careerDetails?.skills?.join(', ') || '-'}
- Universiti Malaysia: ${careerDetails?.uniMY?.join(', ') || '-'}
- Universiti Luar Negara: ${careerDetails?.uniIntl?.join(', ') || '-'}

PANDUAN JAWAPAN:
1. Jawab dalam Bahasa Melayu yang mesra dan mudah faham.
2. Fokus pada kerjaya ${careerName} dan topik berkaitan.
3. Bagi nasihat praktikal — subjek, kemahiran, langkah seterusnya.
4. Kalau soalan di luar skop, sopan redirect balik ke topik kerjaya.
5. Jangan bagi jawapan terlalu panjang — 2-4 ayat cukup.
6. Guna emoji sesekali, jangan berlebihan.`;

        const groqMessages = [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({
                role: m.role === 'user' ? 'user' : 'assistant',
                content: m.text
            }))
        ];

        // =========================================
        // RETRY LOGIC — Cuba 3 kali kalau kena rate limit
        // =========================================
        const MAX_RETRIES = 3;
        let attempt = 0;
        let lastError = null;

        while (attempt < MAX_RETRIES) {
            try {
                const completion = await groq.chat.completions.create({
                    messages: groqMessages,
                    model: 'openai/gpt-oss-120b',
                    temperature: 0.7,
                    max_tokens: 500,
                    top_p: 0.9
                });

                const reply = completion.choices[0]?.message?.content || 'Maaf, saya tak dapat jawab.';
                return res.status(200).json({ reply });

            } catch (error) {
                lastError = error;
                attempt++;

                // =========================================
                // SEMAK JENIS ERROR
                // =========================================
                
                // Error 429 — Rate Limit
                if (error.status === 429) {
                    console.log(`⚠️ Rate limit hit (attempt ${attempt}/${MAX_RETRIES})`);
                    
                    // Cuba ambil "retry-after" dari header (dalam saat)
                    let waitTime = 5; // default 5 saat
                    if (error.headers && error.headers.get) {
                        const retryAfter = error.headers.get('retry-after');
                        if (retryAfter) {
                            waitTime = parseInt(retryAfter) || 5;
                        }
                    }

                    // Kalau ni attempt terakhir, hantar error
                    if (attempt >= MAX_RETRIES) {
                        return res.status(429).json({ 
                            message: `AI tengah sibuk. Sila cuba lagi dalam ${waitTime} saat.` 
                        });
                    }

                    console.log(`⏳ Menunggu ${waitTime}s sebelum cuba lagi...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    continue;
                }

                // Error 503 — Service Unavailable (temporarily down)
                if (error.status === 503) {
                    console.log(`⚠️ Service unavailable (attempt ${attempt}/${MAX_RETRIES})`);
                    
                    if (attempt >= MAX_RETRIES) {
                        return res.status(503).json({ 
                            message: "AI sedang tidak tersedia. Sila cuba sebentar lagi." 
                        });
                    }

                    console.log(`⏳ Menunggu 3s sebelum cuba lagi...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }

                // Error 500/502 — Server error (retry)
                if (error.status >= 500 && error.status < 600) {
                    console.log(`⚠️ Server error ${error.status} (attempt ${attempt}/${MAX_RETRIES})`);
                    
                    if (attempt >= MAX_RETRIES) {
                        return res.status(500).json({ 
                            message: "AI ada masalah teknikal. Sila cuba lagi." 
                        });
                    }

                    // Exponential backoff: 2s, 4s, 8s
                    const waitTime = Math.pow(2, attempt);
                    console.log(`⏳ Menunggu ${waitTime}s sebelum cuba lagi...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                    continue;
                }

                // Error lain (401, 404, dll) — tak payah retry
                throw error;
            }
        }

        // Kalau semua attempt gagal
        console.error("Semua retry gagal:", lastError);
        return res.status(500).json({ 
            message: "Maaf, AI tak dapat jawab sekarang. Cuba lagi nanti." 
        });

    } catch (error) {
        console.error("Groq AI Error:", error);
        res.status(500).json({ 
            message: "Maaf, AI tak dapat jawab sekarang. Cuba lagi nanti." 
        });
    }
});
// =========================================
// API: SIMPAN JAWAPAN SELEPAS EXPLORE
// =========================================
app.post('/api/explore-question', async (req, res) => {
    try {
        const { username, answer } = req.body;

        if (!username || !answer) {
            return res.status(400).json({ message: "Data tak lengkap." });
        }

        if (!['YA', 'TIDAK'].includes(answer)) {
            return res.status(400).json({ message: "Jawapan tidak sah." });
        }

        const user = await User.findOneAndUpdate(
            { username },
            { 
                foundCareerFromExplore: answer,
                foundCareerFromExploreAt: new Date()
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: "Akaun tidak dijumpai." });
        }

        res.status(200).json({ 
            message: "Jawapan berjaya disimpan!",
            answer: user.foundCareerFromExplore
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server." });
    }
});
// =========================================
// API: SIMPAN KOD IMK
// =========================================
app.post('/api/imk-code', async (req, res) => {
    try {
        const { username, imkCode, detail } = req.body;

        if (!username || !imkCode) {
            return res.status(400).json({ message: "Data tak lengkap." });
        }

        const cleanCode = imkCode.toUpperCase().trim();
        if (cleanCode.length !== 3 || !/^[A-Z]{3}$/.test(cleanCode)) {
            return res.status(400).json({ message: "Kod IMK mesti 3 huruf." });
        }

        const updateData = {
            imkCode: cleanCode,
            imkCompletedAt: new Date()
        };

        // Simpan detail kalau ada
        if (detail) {
            updateData.imkDetail = {
                top1: detail.top1,
                top1_score: detail.top1_score,
                top2: detail.top2,
                top2_score: detail.top2_score,
                top3: detail.top3,
                top3_score: detail.top3_score
            };
        }

        const user = await User.findOneAndUpdate(
            { username },
            updateData,
            { new: true }
        );

        if (!user) return res.status(404).json({ message: "Akaun tidak dijumpai." });

        res.status(200).json({ 
            message: "Kod IMK berjaya disimpan!",
            imkCode: user.imkCode,
            imkDetail: user.imkDetail
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server." });
    }
});
// =========================================
// API: TOGGLE FAVOURITE (Add/Remove)
// =========================================
app.post('/api/favourites/toggle', async (req, res) => {
    try {
        const { username, careerName } = req.body;

        if (!username || !careerName) {
            return res.status(400).json({ message: "Data tak lengkap." });
        }

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(404).json({ message: "Akaun tidak dijumpai." });
        }

        const index = user.favourites.indexOf(careerName);

        if (index > -1) {
            user.favourites.splice(index, 1);
        } else {
            user.favourites.push(careerName);
        }

        await user.save();

        res.status(200).json({
            message: index > -1 ? "Dibuang dari simpanan." : "Disimpan ke kegemaran!",
            favourites: user.favourites,
            isFavourite: index === -1
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Ralat server." });
    }
});



// =========================================
// JALANKAN SERVER
// =========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});