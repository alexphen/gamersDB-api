const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const dbPath = path.join(__dirname, 'games.db');
const db = new sqlite3.Database(dbPath);

// Create tables if they don't exist
db.serialize(() => {
  // Games table
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    players INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Gamers table (many-to-many relationship)
  db.run(`CREATE TABLE IF NOT EXISTS game_gamers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    gamer_name TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
  )`);

  // Create indexes for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_game_gamers_game_id ON game_gamers(game_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_game_gamers_gamer_name ON game_gamers(gamer_name)`);
});

// Helper function to get games with gamers
const getGamesWithGamers = (whereClause = '', params = []) => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT 
        g.id,
        g.game,
        g.players,
        GROUP_CONCAT(gg.gamer_name) as gamer_list
      FROM games g
      LEFT JOIN game_gamers gg ON g.id = gg.game_id
      ${whereClause}
      GROUP BY g.id, g.game, g.players
      ORDER BY g.game ASC
    `;
    
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// Helper function to check if games are playable by a group
const getPlayableGames = (playerNames) => {
  return new Promise((resolve, reject) => {
    const placeholders = playerNames.map(() => '?').join(',');
    const query = `
      SELECT 
        g.id,
        g.game,
        g.players,
        GROUP_CONCAT(DISTINCT gg.gamer_name) as gamer_list,
        GROUP_CONCAT(DISTINCT CASE WHEN gg.gamer_name IN (${placeholders}) THEN gg.gamer_name END) as owners_in_group
      FROM games g
      LEFT JOIN game_gamers gg ON g.id = gg.game_id
      GROUP BY g.id, g.game, g.players
      HAVING 
        g.players >= ? AND
        owners_in_group IS NOT NULL
      ORDER BY g.game ASC
    `;
    
    const params = [...playerNames, playerNames.length];
    
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// Routes

// GET /api/games/all - Get all games
app.get('/api/games/all', async (req, res) => {
  try {
    const games = await getGamesWithGamers();
    const items = games.map(game => ({
      rowid: game.id,
      game: game.game,
      players: game.players,
      gamer_list: game.gamer_list || '',
      owners_in_group: null
    }));
    
    res.json({ items });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /api/games/playable - Get games playable by specified players
app.get('/api/games/playable', async (req, res) => {
  try {
    const playersParam = req.query.players;
    if (!playersParam) {
      return res.status(400).json({ error: 'Players parameter is required' });
    }
    
    const playerNames = playersParam.split(',').map(name => name.trim()).filter(name => name);
    if (playerNames.length === 0) {
      return res.status(400).json({ error: 'At least one player name is required' });
    }
    
    const games = await getPlayableGames(playerNames);
    const items = games.map(game => ({
      rowid: game.id,
      game: game.game,
      players: game.players,
      gamer_list: game.gamer_list || '',
      owners_in_group: game.owners_in_group || ''
    }));
    
    res.json({ items });
  } catch (error) {
    console.error('Error fetching playable games:', error);
    res.status(500).json({ error: 'Failed to fetch playable games' });
  }
});

// POST /api/games/all - Add new game
app.post('/api/games/all', (req, res) => {
  const { game, players, gamers } = req.body;
  
  if (!game || !players) {
    return res.status(400).json({ error: 'Game name and players are required' });
  }
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert game
    db.run(
      'INSERT INTO games (game, players) VALUES (?, ?)',
      [game, parseInt(players)],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to add game' });
        }
        
        const gameId = this.lastID;
        
        // Insert gamers if provided
        if (gamers && gamers.trim()) {
          const gamerNames = gamers.split(',').map(name => name.trim()).filter(name => name);
          
          if (gamerNames.length > 0) {
            const stmt = db.prepare('INSERT INTO game_gamers (game_id, gamer_name) VALUES (?, ?)');
            
            let insertCount = 0;
            let insertErrors = 0;
            
            gamerNames.forEach(gamerName => {
              stmt.run([gameId, gamerName], function(err) {
                if (err) {
                  insertErrors++;
                } else {
                  insertCount++;
                }
                
                // Check if all inserts are complete
                if (insertCount + insertErrors === gamerNames.length) {
                  stmt.finalize();
                  
                  if (insertErrors > 0) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to add some gamers' });
                  } else {
                    db.run('COMMIT');
                    return res.json({ success: true, id: gameId });
                  }
                }
              });
            });
          } else {
            db.run('COMMIT');
            return res.json({ success: true, id: gameId });
          }
        } else {
          db.run('COMMIT');
          return res.json({ success: true, id: gameId });
        }
      }
    );
  });
});

// DELETE /api/games/game/:id - Delete game
app.delete('/api/games/game/:id', (req, res) => {
  const gameId = req.params.id;
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Delete gamers first (foreign key constraint)
    db.run('DELETE FROM game_gamers WHERE game_id = ?', [gameId], function(err) {
      if (err) {
        db.run('ROLLBACK');
        return res.status(500).json({ error: 'Failed to delete game gamers' });
      }
      
      // Delete game
      db.run('DELETE FROM games WHERE id = ?', [gameId], function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to delete game' });
        }
        
        if (this.changes === 0) {
          db.run('ROLLBACK');
          return res.status(404).json({ error: 'Game not found' });
        }
        
        db.run('COMMIT');
        return res.json({ success: true });
      });
    });
  });
});

// POST /api/games/game/:id/gamers - Add gamer to game
app.post('/api/games/game/:id/gamers', (req, res) => {
  const gameId = req.params.id;
  const { gamer_name } = req.body;
  
  if (!gamer_name || !gamer_name.trim()) {
    return res.status(400).json({ error: 'Gamer name is required' });
  }
  
  // Check if gamer already exists for this game
  db.get(
    'SELECT id FROM game_gamers WHERE game_id = ? AND gamer_name = ?',
    [gameId, gamer_name.trim()],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (row) {
        return res.status(400).json({ error: 'Gamer already exists for this game' });
      }
      
      // Add gamer
      db.run(
        'INSERT INTO game_gamers (game_id, gamer_name) VALUES (?, ?)',
        [gameId, gamer_name.trim()],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to add gamer' });
          }
          
          return res.json({ success: true, id: this.lastID });
        }
      );
    }
  );
});

// DELETE /api/games/game/:id/gamers - Remove gamer from game
app.delete('/api/games/game/:id/gamers', (req, res) => {
  const gameId = req.params.id;
  const { gamer_name } = req.body;
  
  if (!gamer_name) {
    return res.status(400).json({ error: 'Gamer name is required' });
  }
  
  db.run(
    'DELETE FROM game_gamers WHERE game_id = ? AND gamer_name = ?',
    [gameId, gamer_name],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to remove gamer' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Gamer not found for this game' });
      }
      
      return res.json({ success: true });
    }
  );
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});