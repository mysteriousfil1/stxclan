const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, 'database.sqlite'),
  logging: false // Disable logging for cleaner console
});

// User model for Discord log-ins and tracking VIP/sub info
const User = sequelize.define('User', {
  discord_id: {
    type: DataTypes.STRING,
    primaryKey: true,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false
  },
  avatar: {
    type: DataTypes.STRING,
    allowNull: true
  },
  subscriptionPackage: {
    type: DataTypes.STRING,
    defaultValue: 'Member'
  },
  subscriptionExpiry: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isAdmin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  lastLogin: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
}, {
  timestamps: true
});

// Leaderboard model (to store what was previously mock data)
const Leaderboard = sequelize.define('Leaderboard', {
  playerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  kills: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  deaths: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  score: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  timestamps: true
});

// Initialize database
const initDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');
    // Sync all models (use alter: true to update schema if needed)
    await sequelize.sync({ alter: true });
    console.log('Database synchronized.');
    
    // Seed mock data for leaderboard if it's empty
    const count = await Leaderboard.count();
    if (count === 0) {
      await Leaderboard.bulkCreate([
        { playerName: 'Player_STX_1', kills: 120, deaths: 45, score: 5000 },
        { playerName: 'Commander_X', kills: 98, deaths: 30, score: 4800 },
        { playerName: 'Sniper_Pro', kills: 85, deaths: 12, score: 4500 },
        { playerName: 'Medic_STX', kills: 45, deaths: 34, score: 4200 },
        { playerName: 'Vehicle_God', kills: 110, deaths: 60, score: 4000 }
      ]);
      console.log('Seed data added to Leaderboard.');
    }
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
};

module.exports = { sequelize, User, Leaderboard, initDB };
