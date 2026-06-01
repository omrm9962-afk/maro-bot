const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const { Telegraf, Markup } = require('telegraf');
const cron = require('node-cron');
const os = require('os');

// ============== CONFIG ==============
const config = JSON.parse(fsSync.readFileSync('./config.json', 'utf8'));
const botToken = process.env.BOT_TOKEN || config.botToken;
const bot = new Telegraf(botToken);
const adminId = parseInt(process.env.ADMIN_ID) || config.adminId;
const channels = config.channels;

// ============== COLORS FOR CONSOLE ==============
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m'
};

function log(msg, type = 'info') {
    const timestamp = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
    switch(type) {
        case 'error':
            console.log(`${colors.bgRed}${colors.white}[${timestamp}] ERROR ${colors.reset} ${colors.red}${msg}${colors.reset}`);
            break;
        case 'success':
            console.log(`${colors.bgGreen}${colors.black}[${timestamp}] SUCCESS ${colors.reset} ${colors.green}${msg}${colors.reset}`);
            break;
        case 'warning':
            console.log(`${colors.bgYellow}${colors.black}[${timestamp}] WARNING ${colors.reset} ${colors.yellow}${msg}${colors.reset}`);
            break;
        case 'info':
            console.log(`${colors.cyan}[${timestamp}] INFO ${colors.reset} ${msg}`);
            break;
        case 'user':
            console.log(`${colors.magenta}[${timestamp}] USER ${colors.reset} ${msg}`);
            break;
        case 'bot':
            console.log(`${colors.blue}[${timestamp}] BOT ${colors.reset} ${msg}`);
            break;
        default:
            console.log(`${colors.white}[${timestamp}] ${msg}${colors.reset}`);
    }
}

// ============== TEMP DIRECTORY ==============
const TEMP_BASE = path.join(__dirname, 'temp');
if (!fsSync.existsSync(TEMP_BASE)) {
    fsSync.mkdirSync(TEMP_BASE, { recursive: true });
    log(`TEMP directory created at: ${TEMP_BASE}`, 'success');
}

// ============== STATISTICS ==============
const stats = {
    totalUsers: 0,
    totalBuilds: 0,
    totalErrors: 0,
    startTime: Date.now(),
    activeBuilds: 0
};

// ============== USER STATE ==============
const userStates = new Map();

// ============== KEEP ALIVE FUNCTION ==============
async function keepAlive() {
    try {
        const response = await axios.get('https://api.telegram.org/bot' + config.botToken + '/getMe');
        if (response.data.ok) {
            log('✅ Bot is alive and running!', 'success');
        }
    } catch (err) {
        log(`Keep alive failed: ${err.message}`, 'error');
    }
}

// Run keep alive every 5 minutes
setInterval(keepAlive, 5 * 60 * 1000);

// ============== DAILY STATS ==============
cron.schedule('0 0 * * *', () => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60 / 60);
    log(`📊 DAILY STATS - Users: ${stats.totalUsers} | Builds: ${stats.totalBuilds} | Errors: ${stats.totalErrors} | Uptime: ${uptime}h`, 'info');
    stats.totalBuilds = 0;
    stats.totalErrors = 0;
});

// ============== HELPERS ==============
const MAX_TG_SIZE = 45 * 1024 * 1024; // 45MB — Telegram limit is 50MB

async function sendZipFile(ctx, zipPath, filename, caption) {
    const { size } = fsSync.statSync(zipPath);
    
    if (size <= MAX_TG_SIZE) {
        return await ctx.replyWithDocument({ source: zipPath, filename }, { caption });
    }
    
    // Split into parts
    const partSize = MAX_TG_SIZE;
    const totalParts = Math.ceil(size / partSize);
    const partPaths = [];
    
    log(`📦 File too large (${(size/1024/1024).toFixed(1)}MB), splitting into ${totalParts} parts`, 'info');
    
    await ctx.reply(
        `📦 الملف كبير (${(size/1024/1024).toFixed(1)}MB)\n` +
        `✂️ هيتبعتلك ${totalParts} أجزاء — ادمجهم بعدين:\n` +
        `\`cat part1 part2 ... > full.zip\``,
        { parse_mode: 'Markdown' }
    );
    
    const fileHandle = fsSync.openSync(zipPath, 'r');
    try {
        for (let i = 0; i < totalParts; i++) {
            const partPath = `${zipPath}.part${i + 1}`;
            const buffer = Buffer.alloc(Math.min(partSize, size - i * partSize));
            fsSync.readSync(fileHandle, buffer, 0, buffer.length, i * partSize);
            fsSync.writeFileSync(partPath, buffer);
            partPaths.push(partPath);
            
            const partFilename = `${filename.replace('.zip', '')}_part${i + 1}of${totalParts}.zip`;
            await ctx.replyWithDocument(
                { source: partPath, filename: partFilename },
                { caption: `📦 Part ${i + 1}/${totalParts} — ${(buffer.length/1024/1024).toFixed(1)}MB` }
            );
            log(`📤 Sent part ${i + 1}/${totalParts}`, 'info');
        }
    } finally {
        fsSync.closeSync(fileHandle);
        for (const p of partPaths) {
            if (fsSync.existsSync(p)) fsSync.unlinkSync(p);
        }
    }
    
    // Return a dummy msg object for compatibility
    return null;
}

async function deleteFileAfterDelay(filePath, userId, messageId, delayMs = 3 * 60 * 60 * 1000) {
    setTimeout(async () => {
        try {
            if (fsSync.existsSync(filePath)) {
                await fs.unlink(filePath);
                log(`🗑 Deleted file: ${path.basename(filePath)}`, 'success');
            }
            if (messageId) {
                await bot.telegram.deleteMessage(userId, messageId).catch(() => {});
                log(`🗑 Deleted message ${messageId} for user ${userId}`, 'info');
            }
        } catch (err) {
            log(`Failed to delete: ${err.message}`, 'error');
        }
    }, delayMs);
}

async function checkSubscription(ctx) {
    for (const channel of channels) {
        try {
            const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
            if (member.status === 'left' || member.status === 'kicked') {
                return false;
            }
        } catch (err) {
            return false;
        }
    }
    return true;
}

function sendForceJoinKeyboard(ctx, lang) {
    const keyboard = [];
    for (const channel of channels) {
        keyboard.push([Markup.button.url(channel.name, channel.url)]);
    }
    keyboard.push([Markup.button.callback(config.strings[lang].sub_button, 'check_sub')]);
    return Markup.inlineKeyboard(keyboard);
}

// ============== MIDDLEWARES ==============
bot.use(async (ctx, next) => {
    if (ctx.callbackQuery && ctx.callbackQuery.data === 'check_sub') {
        return next();
    }
    if (!ctx.from || !ctx.message) return next();
    
    // Update stats
    if (!userStates.has(ctx.from.id)) {
        stats.totalUsers++;
        log(`👤 New user: ${ctx.from.username || ctx.from.first_name} (ID: ${ctx.from.id})`, 'user');
    }
    
    if (!userStates.has(ctx.from.id)) {
        userStates.set(ctx.from.id, { lang: null, step: null, libName: null, libVersion: null, tempDir: null, timeoutId: null });
    }
    
    const isSub = await checkSubscription(ctx);
    if (!isSub) {
        const lang = userStates.get(ctx.from.id).lang || 'ar';
        log(`⚠️ User ${ctx.from.username || ctx.from.id} not subscribed to channels`, 'warning');
        return ctx.reply(config.strings[lang].sub_required, sendForceJoinKeyboard(ctx, lang));
    }
    
    log(`📨 Message from ${ctx.from.username || ctx.from.first_name}: ${ctx.message.text || '[non-text]'}`, 'user');
    return next();
});

// ============== MAIN COMMANDS ==============
bot.start(async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🇪🇬 العربية', 'lang_ar')],
        [Markup.button.callback('🇬🇧 English', 'lang_en')],
        [Markup.button.callback('🇷🇺 Русский', 'lang_ru')]
    ]);
    await ctx.reply('🌍 Choose your language / اختر لغتك / Выберите язык:', keyboard);
    log(`🌟 User ${ctx.from.username || ctx.from.id} started the bot`, 'user');
});

bot.action(/lang_(.+)/, async (ctx) => {
    const lang = ctx.match[1];
    const state = userStates.get(ctx.from.id) || {};
    state.lang = lang;
    state.step = null;
    userStates.set(ctx.from.id, state);
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(config.strings[lang].btn_name, 'mode_name')],
        [Markup.button.callback(config.strings[lang].btn_file, 'mode_file')]
    ]);
    await ctx.editMessageText(config.strings[lang].welcome + '\n\n' + config.strings[lang].choose_mode, { parse_mode: 'Markdown', ...keyboard });
    log(`🌐 User ${ctx.from.username || ctx.from.id} selected language: ${lang}`, 'info');
});

bot.action('mode_name', async (ctx) => {
    const state = userStates.get(ctx.from.id);
    const lang = state.lang;
    state.step = 'awaiting_lib_name';
    userStates.set(ctx.from.id, state);
    await ctx.editMessageText(config.strings[lang].ask_name, { parse_mode: 'Markdown' });
    log(`🔍 User ${ctx.from.username || ctx.from.id} chose search by name mode`, 'info');
});

bot.action('mode_file', async (ctx) => {
    const state = userStates.get(ctx.from.id);
    const lang = state.lang;
    state.step = 'awaiting_package_json';
    userStates.set(ctx.from.id, state);
    await ctx.editMessageText(config.strings[lang].ask_file);
    log(`📂 User ${ctx.from.username || ctx.from.id} chose upload package.json mode`, 'info');
});

// ============== SEARCH LIBRARY ==============
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (!state || state.step !== 'awaiting_lib_name') return;
    
    const lang = state.lang;
    const libName = ctx.message.text.trim();
    
    await ctx.reply(config.strings[lang].searching);
    log(`🔎 User ${ctx.from.username || ctx.from.id} searching for: ${libName}`, 'info');
    
    try {
        const res = await axios.get(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(libName)}&size=5`);
        const packages = res.data.objects;
        
        if (!packages.length) {
            const noResultKeyboard = Markup.inlineKeyboard([
                [Markup.button.callback(config.strings[lang].no_result_btn, 'no_result')]
            ]);
            await ctx.reply(config.strings[lang].not_found, noResultKeyboard);
            state.step = null;
            userStates.set(userId, state);
            log(`❌ No results found for: ${libName}`, 'warning');
            return;
        }
        
        const keyboard = [];
        for (const pkg of packages) {
            const name = pkg.package.name;
            const desc = pkg.package.description ? pkg.package.description.substring(0, 50) : '';
            keyboard.push([Markup.button.callback(`📦 ${name}\n${desc}`, `select_${name}`)]);
        }
        keyboard.push([Markup.button.callback(config.strings[lang].no_result_btn, 'no_result')]);
        
        await ctx.reply(config.strings[lang].confirm_lib, Markup.inlineKeyboard(keyboard));
        state.libName = libName;
        userStates.set(userId, state);
        log(`✅ Found ${packages.length} results for: ${libName}`, 'success');
        
    } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
        state.step = null;
        userStates.set(userId, state);
        log(`❌ Search error for ${libName}: ${err.message}`, 'error');
        stats.totalErrors++;
    }
});

bot.action(/select_(.+)/, async (ctx) => {
    const libName = ctx.match[1];
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const lang = state.lang;
    
    log(`📦 User ${ctx.from.username || ctx.from.id} selected library: ${libName}`, 'info');
    
    try {
        const res = await axios.get(`https://registry.npmjs.org/${libName}`);
        const versions = Object.keys(res.data.versions).reverse().slice(0, 5);
        
        const keyboard = [];
        for (const ver of versions) {
            keyboard.push([Markup.button.callback(`📌 ${ver}`, `ver_${libName}_${ver}`)]);
        }
        keyboard.push([Markup.button.callback(config.strings[lang].btn_no, 'cancel')]);
        
        await ctx.editMessageText(config.strings[lang].choose_ver, Markup.inlineKeyboard(keyboard));
        state.libName = libName;
        userStates.set(userId, state);
        
    } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
        log(`❌ Error fetching versions for ${libName}: ${err.message}`, 'error');
        stats.totalErrors++;
    }
});

bot.action(/ver_(.+)_(.+)/, async (ctx) => {
    const libName = ctx.match[1];
    const version = ctx.match[2];
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const lang = state.lang;
    
    await ctx.editMessageText(config.strings[lang].building);
    log(`🔨 User ${ctx.from.username || ctx.from.id} building: ${libName}@${version}`, 'info');
    stats.activeBuilds++;
    stats.totalBuilds++;
    
    const tempDir = path.join(TEMP_BASE, `user_${userId}_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    state.tempDir = tempDir;
    userStates.set(userId, state);
    
    try {
        const packageJson = {
            name: `temp-${libName}`,
            version: '1.0.0',
            dependencies: { [libName]: version }
        };
        await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));
        
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
            exec(`cd ${tempDir} && npm install --no-audit --no-fund --quiet`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        
        const zipPath = path.join(TEMP_BASE, `${libName}-${version}.zip`);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(tempDir, false);
            archive.finalize();
        });
        
        const msg = await sendZipFile(
            ctx,
            zipPath,
            `${libName}-${version}.zip`,
            `${config.strings[lang].success}\n\n👑 Developer: MARO\n📦 Library: ${libName}@${version}`
        );
        
        deleteFileAfterDelay(zipPath, userId, msg?.message_id);
        
        setTimeout(async () => {
            await fs.rm(tempDir, { recursive: true, force: true });
        }, 60 * 60 * 1000);
        
        state.step = null;
        userStates.set(userId, state);
        stats.activeBuilds--;
        log(`✅ Build successful: ${libName}@${version} for user ${ctx.from.username || ctx.from.id}`, 'success');
        
    } catch (err) {
        await ctx.reply(`❌ Build failed: ${err.message}`);
        state.step = null;
        userStates.set(userId, state);
        stats.activeBuilds--;
        stats.totalErrors++;
        log(`❌ Build failed for ${libName}@${version}: ${err.message}`, 'error');
    }
});

// ============== PACKAGE.JSON MODE ==============
bot.on('document', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (!state || state.step !== 'awaiting_package_json') return;
    
    const lang = state.lang;
    const file = ctx.message.document;
    
    if (!file.file_name.endsWith('package.json')) {
        await ctx.reply('❌ Please send a valid package.json file');
        log(`⚠️ User ${ctx.from.username || ctx.from.id} sent invalid file: ${file.file_name}`, 'warning');
        return;
    }
    
    await ctx.reply(config.strings[lang].building);
    log(`📦 User ${ctx.from.username || ctx.from.id} uploaded package.json for build`, 'info');
    stats.activeBuilds++;
    stats.totalBuilds++;
    
    const tempDir = path.join(TEMP_BASE, `user_${userId}_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    try {
        const fileLink = await ctx.telegram.getFileLink(file.file_id);
        const res = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        await fs.writeFile(path.join(tempDir, 'package.json'), res.data);
        
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
            exec(`cd ${tempDir} && npm install --no-audit --no-fund --quiet`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        
        const zipPath = path.join(TEMP_BASE, `package_${userId}_${Date.now()}.zip`);
        const output = fsSync.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(tempDir, false);
            archive.finalize();
        });
        
        const msg = await sendZipFile(
            ctx,
            zipPath,
            `modules-${Date.now()}.zip`,
            `${config.strings[lang].success}\n\n👑 Developer: MARO`
        );
        
        deleteFileAfterDelay(zipPath, userId, msg?.message_id);
        
        setTimeout(async () => {
            await fs.rm(tempDir, { recursive: true, force: true });
        }, 60 * 60 * 1000);
        
        state.step = null;
        userStates.set(userId, state);
        stats.activeBuilds--;
        log(`✅ Package.json build successful for user ${ctx.from.username || ctx.from.id}`, 'success');
        
    } catch (err) {
        await ctx.reply(`❌ Build failed: ${err.message}`);
        state.step = null;
        userStates.set(userId, state);
        stats.activeBuilds--;
        stats.totalErrors++;
        log(`❌ Package.json build failed: ${err.message}`, 'error');
    }
});

// ============== NO RESULT ==============
bot.action('no_result', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const lang = state.lang;
    await ctx.editMessageText(config.strings[lang].how_to_help);
    state.step = null;
    userStates.set(userId, state);
    log(`ℹ️ User ${ctx.from.username || ctx.from.id} clicked no result button`, 'info');
});

bot.action('cancel', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    state.step = null;
    userStates.set(userId, state);
    await ctx.editMessageText('❌ Cancelled');
    log(`❌ User ${ctx.from.username || ctx.from.id} cancelled operation`, 'info');
});

bot.action('check_sub', async (ctx) => {
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    const lang = state?.lang || 'ar';
    const isSub = await checkSubscription(ctx);
    if (isSub) {
        await ctx.answerCbQuery('✅ Subscribed!');
        await ctx.deleteMessage();
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback(config.strings[lang].btn_name, 'mode_name')],
            [Markup.button.callback(config.strings[lang].btn_file, 'mode_file')]
        ]);
        await ctx.reply(config.strings[lang].choose_mode, keyboard);
        log(`✅ User ${ctx.from.username || ctx.from.id} verified subscription`, 'success');
    } else {
        await ctx.answerCbQuery('❌ Not subscribed yet!', true);
        log(`⚠️ User ${ctx.from.username || ctx.from.id} attempted to verify but not subscribed`, 'warning');
    }
});

// ============== ADMIN BROADCAST ==============
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id !== adminId) return;
    const msg = ctx.message.text.split(' ').slice(1).join(' ');
    if (!msg) return ctx.reply('Usage: /broadcast <message>');
    
    log(`📢 Admin broadcasting: ${msg}`, 'bot');
    let count = 0;
    for (const [userId] of userStates) {
        try {
            await ctx.telegram.sendMessage(userId, `📢 *Broadcast from Developer*\n\n${msg}`, { parse_mode: 'Markdown' });
            count++;
        } catch(e) {}
    }
    await ctx.reply(`✅ Broadcast sent to ${count} users`);
    log(`📢 Broadcast sent to ${count} users`, 'success');
});

// ============== STATS COMMAND ==============
bot.command('stats', async (ctx) => {
    if (ctx.from.id !== adminId) return;
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000 / 60 / 60);
    const memoryUsage = process.memoryUsage();
    const usedMemory = Math.floor(memoryUsage.heapUsed / 1024 / 1024);
    const totalMemory = Math.floor(memoryUsage.heapTotal / 1024 / 1024);
    
    const statsMsg = `📊 *Bot Statistics* 📊\n\n` +
        `👥 Total Users: ${stats.totalUsers}\n` +
        `🔨 Total Builds: ${stats.totalBuilds}\n` +
        `❌ Total Errors: ${stats.totalErrors}\n` +
        `⚡ Active Builds: ${stats.activeBuilds}\n` +
        `⏱️ Uptime: ${uptime} hours\n` +
        `💾 Memory: ${usedMemory}/${totalMemory} MB\n` +
        `🟢 Status: Online\n` +
        `🤖 Bot: MARO ULTRA MODULES`;
    
    await ctx.reply(statsMsg, { parse_mode: 'Markdown' });
    log(`📊 Stats command executed by admin`, 'info');
});

// ============== START ==============
bot.launch();
log('🚀 MARO ULTRA MODULES BOT is running...', 'success');
log(`📊 Starting with ${stats.totalUsers} users tracked`, 'info');
log(`💾 Temp directory: ${TEMP_BASE}`, 'info');
log(`👑 Admin ID: ${adminId}`, 'info');
log(`📢 Channels to check: ${channels.map(c => c.name).join(', ')}`, 'info');

// Graceful stop
process.once('SIGINT', () => {
    log('🛑 Bot shutting down...', 'warning');
    bot.stop('SIGINT');
    process.exit(0);
});
process.once('SIGTERM', () => {
    log('🛑 Bot shutting down...', 'warning');
    bot.stop('SIGTERM');
    process.exit(0);
});