const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { getConnection } = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const PORT = process.env.PORT || 3001;

// Fetch all games
app.get('/api/games/all', async (req, res) => {
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT rowid, game, players, gamers FROM games`
    );
    const items = result.rows.map(row => ({
      rowid: row[0],
      game: row[1],
      players: row[2],
      gamer_list: row[3],
      owners_in_group: row[4]
    }));
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

// Add a game
app.post('/api/games/all', async (req, res) => {
  console.log(req.body)
  const { game, players, gamers } = req.body;
  console.log(`INSERT INTO games (game, players, gamers) VALUES (:game, :players, :gamers)`, [game, players, gamers]);
  const conn = await getConnection();
  try {
    await conn.execute(
      // `INSERT INTO games (game, players, gamers) VALUES (:game, :players, :gamers)`,
      // [game, players, gamers],
      // { autoCommit: true }
      `INSERT INTO games VALUES ${game}, ${players}, gamers_storage_table(aphen.gamer_names_type()
      )`
    );
    res.status(201).json({ message: 'Game added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

// Delete game by ROWID
app.delete('/api/games/game/:id', async (req, res) => {
  const { id } = req.params;
  const conn = await getConnection();
  try {
    await conn.execute(`DELETE FROM games WHERE rowid = :id`, [id], { autoCommit: true });
    res.json({ message: 'Game deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

// Add gamer
app.post('/api/games/game/:id/gamers', async (req, res) => {
  const { id } = req.params;
  const { gamer_name } = req.body;
  const conn = await getConnection();
  try {
    await conn.execute(
      `UPDATE games SET gamers = COALESCE(gamers, '') || ',' || :gamer_name WHERE rowid = :id`,
      [gamer_name, id],
      { autoCommit: true }
    );
    res.json({ message: 'Gamer added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

// Remove gamer
app.delete('/api/games/game/:id/gamers', async (req, res) => {
  const { id } = req.params;
  const { gamer_name } = req.body;
  const conn = await getConnection();
  try {
    const result = await conn.execute(
      `SELECT gamers FROM games WHERE rowid = :id`,
      [id]
    );
    const gamers = result.rows[0][0]?.split(',').map(g => g.trim()).filter(Boolean) || [];
    const updated = gamers.filter(g => g !== gamer_name).join(',');
    await conn.execute(
      `UPDATE games SET gamers = :updated WHERE rowid = :id`,
      [updated, id],
      { autoCommit: true }
    );
    res.json({ message: 'Gamer removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

// Optional: Add route for playable games
app.get('/api/games/playable', async (req, res) => {
  const { players } = req.query;
  const playerList = players?.split(',').map(p => p.trim());
  const conn = await getConnection();

  try {
    const result = await conn.execute(
      `SELECT rowid, game, players, gamers FROM games`
    );

    const items = result.rows.map(row => {
      const owners = row[3]?.split(',').map(g => g.trim()) || [];
      const ownersInGroup = owners.filter(owner => playerList.includes(owner));
      return {
        rowid: row[0],
        game: row[1],
        players: row[2],
        gamer_list: row[3],
        owners_in_group: ownersInGroup.join(',')
      };
    }).filter(g => g.owners_in_group && g.players >= playerList.length);

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await conn.close();
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
