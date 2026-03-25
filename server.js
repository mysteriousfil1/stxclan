const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const Gamedig = require('gamedig');
const path = require('path');
require('dotenv').config();
const axios = require('axios');
const { User, Leaderboard, initDB } = require('./database.js');

// Initialize database
initDB();


const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Discord OAuth2 Credentials
const CLIENT_ID = process.env.CLIENT_ID || '1485440567931306176';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'gmXJDzCOqdwzDj92NJSVuwnW2N4NpxCW';
const REDIRECT_URL = 'https://stxclan.onrender.com/auth/discord/callback';


// Squad Server Credentials
const SQUAD_IP = '104.167.24.87';
const SQUAD_PORT = 10202;

// Admin Credentials (Simple for now)
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'stx_admin_2026';

// Discord Server Configuration
const STX_GUILD_ID = '1461017302655959052'; // Target Guild ID (Check from Discord)
const VIP_ROLES = {
    '1461017303020736780': '🏆 𝐕𝐈𝐏 𝐖𝐡𝐢𝐭𝐞𝐥𝐢𝐬𝐭 Platinum', // Highest
    '1481612424388935681': '🏆 𝐕𝐈𝐏 𝐖𝐡𝐢𝐭𝐞𝐥𝐢𝐬𝐭 Golden',  // Middle
    '1481612895388434596': '🥈 𝐒𝐢𝐥𝐯𝐞𝐫 𝐃𝐨𝐧𝐞𝐭𝐞𝐫'             // Lowest
};

// Passport Setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: REDIRECT_URL,
    scope: ['identify', 'guilds', 'guilds.members.read']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let userPackage = 'Member';
        let expiryDate = null;
        
        // Fetch user roles in the STX guild using the user's token
        try {
            const memberRes = await axios.get(`https://discord.com/api/guilds/${STX_GUILD_ID}/members/${profile.id}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (memberRes.data && memberRes.data.roles) {
                const userRoles = memberRes.data.roles;
                
                // Prioritize top-most role
                if (userRoles.includes('1461017303020736780')) userPackage = VIP_ROLES['1461017303020736780'];
                else if (userRoles.includes('1481612424388935681')) userPackage = VIP_ROLES['1481612424388935681'];
                else if (userRoles.includes('1481612895388434596')) userPackage = VIP_ROLES['1481612895388434596'];
                
                // If they have a VIP package, set expiry to 30 days from now
                if (userPackage !== 'Member') {
                    expiryDate = new Date();
                    expiryDate.setDate(expiryDate.getDate() + 30);
                }
            }
        } catch (discordErr) {
            console.warn('Failed to fetch Discord member roles:', discordErr.response?.data || discordErr.message);
        }

        const [user, created] = await User.findOrCreate({
            where: { discord_id: profile.id },
            defaults: {
                username: profile.username,
                avatar: profile.avatar || '',
                subscriptionPackage: userPackage,
                subscriptionExpiry: expiryDate,
                lastLogin: new Date()
            }
        });

        // Update username/avatar/package if they changed
        if (!created) {
            user.username = profile.username;
            user.avatar = profile.avatar || '';
            user.lastLogin = new Date();
            // Always update subscription if they have a role (or clear it if they don't, but let's stick to update)
            user.subscriptionPackage = userPackage;
            user.subscriptionExpiry = expiryDate;
            await user.save();
        }
        
        console.log(`User ${profile.username} sync'd with package: ${userPackage}`);
        return done(null, user.get({ plain: true }));
    } catch (err) {
        console.error('Error finding/creating user:', err);
        return done(err);
    }
}));

// Middleware
app.use(express.json());
app.use(session({
    secret: 'steel-x-community-super-secret-key-2026',
    resave: true,
    saveUninitialized: true,
    cookie: { secure: false } // Set to false for localhost/HTTP
}));
app.use(passport.initialize());
app.use(passport.session());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
// Serving static files from root for individual html files
app.use(express.static(__dirname));

// Routes
app.get('/auth/discord', (req, res, next) => {
    console.log('Initiating Discord Login...');
    passport.authenticate('discord')(req, res, next);
});

app.get('/auth/discord/callback', (req, res, next) => {
    console.log('Discord Callback Received...');
    passport.authenticate('discord', (err, user, info) => {
        if (err) {
            console.error('Auth Error:', err);
            return res.redirect('/?error=auth_failed');
        }
        if (!user) {
            console.warn('No user found in callback:', info);
            return res.redirect('/?error=no_user');
        }
        req.logIn(user, (err) => {
            if (err) {
                console.error('Login Error:', err);
                return res.redirect('/?error=login_failed');
            }
            console.log('User Logged In Successfully:', user.username);
            return res.redirect('/dashboard.html');
        });
    })(req, res, next);
});

app.get('/api/user', async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            // Fetch latest user data from DB
            const user = await User.findByPk(req.user.discord_id);
            if (!user) return res.status(404).json({ error: 'User not found in DB' });
            
            // Fetch real Playtime and K/D from BattleMetrics based on username
            let playtime = 0;
            let kd = '0.0';
            
            try {
                // Search for the player by name in BM
                const bmSearch = await axios.get(`https://api.battlemetrics.com/players?filter[search]=${encodeURIComponent(user.username)}&page[size]=1`, {
                    timeout: 4000
                });
                
                if (bmSearch.data.data && bmSearch.data.data.length > 0) {
                    const bmPlayer = bmSearch.data.data[0];
                    const playerId = bmPlayer.id;
                    
                    // Fetch details (specifically for the Squad server)
                    // We need the server ID from BM. 
                    // Let's first quickly find the server's BM ID if we don't have it
                    const bmServerSearch = await axios.get(`https://api.battlemetrics.com/servers?filter[address]=${SQUAD_IP}&filter[port]=${SQUAD_PORT}`, { timeout: 3000 });
                    if (bmServerSearch.data.data && bmServerSearch.data.data.length > 0) {
                        const serverId = bmServerSearch.data.data[0].id;
                        
                        // Get player stats for this server
                        const bmStats = await axios.get(`https://api.battlemetrics.com/players/${playerId}/servers/${serverId}`, { timeout: 3000 });
                        if (bmStats.data.data) {
                            const details = bmStats.data.data.attributes;
                            playtime = Math.round(details.timePlayed / 3600); // converting seconds to hours
                            
                            // Calculate K/D if available in metadata (Squad specific)
                            // BM sometimes provides kills/deaths in metadata for some servers
                            const metadata = bmStats.data.data.meta || {};
                            const kills = metadata.kills || 0;
                            const deaths = metadata.deaths || 1;
                            kd = (kills / Math.max(1, deaths)).toFixed(2);
                        }
                    }
                }
            } catch (bmErr) {
                console.error('BM Stats Fetch Error:', bmErr.message);
            }

            const userData = {
                ...user.get({ plain: true }),
                playtime: playtime || 0,
                kd: kd || '0.0'
            };
            
            res.json(userData);
        } catch (err) {
            console.error('Error fetching user from DB:', err);
            res.status(500).json({ error: 'Database error' });
        }
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Admin Login API
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/api/admin/status', (req, res) => {
    if (req.session.isAdmin) {
        res.json({ isAdmin: true });
    } else {
        res.status(401).json({ isAdmin: false });
    }
});

// Admin Players API
app.get('/api/admin/players', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const players = await User.findAll({
            order: [['createdAt', 'DESC']]
        });
        res.json(players);
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    try {
        const totalPlayers = await User.count();
        const activeVIPs = await User.count({
            where: {
                subscriptionPackage: {
                    [require('./database.js').sequelize.Sequelize.Op.ne]: 'Member'
                }
            }
        });
        res.json({ totalPlayers, activeVIPs });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/api/admin/update-player', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: 'Unauthorized' });
    const { discord_id, subscriptionPackage, subscriptionExpiry } = req.body;
    try {
        const user = await User.findByPk(discord_id);
        if (!user) return res.status(404).json({ error: 'Player not found' });
        
        user.subscriptionPackage = subscriptionPackage;
        user.subscriptionExpiry = subscriptionExpiry ? new Date(subscriptionExpiry) : null;
        await user.save();
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).send('Logout failed');
        res.redirect('/');
    });
});

// Squad Server Status API (Trying BattleMetrics and Gamedig)


app.get('/api/server-status', async (req, res) => {
    try {
        // Try BattleMetrics first
        // Note: Replace with actual ID if found
        const bmResponse = await axios.get(`https://api.battlemetrics.com/servers?filter[address]=${SQUAD_IP}&filter[port]=${SQUAD_PORT}`, {
            timeout: 5000
        });
        
        if (bmResponse.data.data && bmResponse.data.data.length > 0) {
            const server = bmResponse.data.data[0].attributes;
            return res.json({
                name: server.name,
                players: server.players,
                maxplayers: server.maxPlayers,
                map: server.details.map || 'Unknown',
                status: server.status === 'online' ? 'Online' : 'Offline'
            });
        }

        // Fallback to Gamedig
        const state = await Gamedig.query({
            type: 'squad',
            host: SQUAD_IP,
            port: SQUAD_PORT
        });
        res.json({
            name: state.name,
            players: state.players.length,
            maxplayers: state.maxplayers,
            map: state.map,
            status: 'Online'
        });
    } catch (error) {
        console.error('Server Status Error:', error.message);
        res.json({
            name: '#1 [ STX ] ARABIC And ENGLISH | STEEL X Community',
            players: 0,
            maxplayers: 100,
            map: 'Offline',
            status: 'Offline'
        });
    }
});

// Mock Leaderboard Data (Replace with real SquadJS fetch logic)
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Fetch server ID first if not cached (you might want to hardcode this for speed)
        const bmServerSearch = await axios.get(`https://api.battlemetrics.com/servers?filter[address]=${SQUAD_IP}&filter[port]=${SQUAD_PORT}`, { timeout: 3000 });
        if (!bmServerSearch.data.data || bmServerSearch.data.data.length === 0) {
            throw new Error('Server not found on BattleMetrics');
        }
        const serverId = bmServerSearch.data.data[0].id;

        // Fetch players for this server (limit 50)
        // Note: BattleMetrics 'players' filter for a server returns currently/recently online.
        // For a true all-time leaderboard, we'd need a specific leaderboard API or SquadJS.
        // For now, we get the players currently/recently on the server.
        const bmPlayers = await axios.get(`https://api.battlemetrics.com/servers/${serverId}?include=player`, { timeout: 5000 });
        
        const players = (bmPlayers.data.included || [])
            .filter(item => item.type === 'player')
            .map(p => ({
                playerName: p.attributes.name,
                kills: Math.floor(Math.random() * 100), // BM doesn't expose K/D in basic query
                deaths: Math.floor(Math.random() * 50),
                score: Math.floor(Math.random() * 5000),
                avatar: p.attributes.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png'
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 50);

        res.json(players);
    } catch (err) {
        console.error('Error fetching leaderboard from BM:', err.message);
        // Fallback to local DB if BM fails
        const localData = await Leaderboard.findAll({ order: [['score', 'DESC']], limit: 50 });
        res.json(localData);
    }
});

// Fallback for HTML pages
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on https://stxclan.onrender.com/`);
});
