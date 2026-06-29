const express = require("express");
const cors = require("cors");
const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("FCOS Backend Running");
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

app.post("/api/results", async (req, res) => {
  try {

    const {
      shipment_id,
      space_utilisation,
      weight_utilisation,
      opt_score
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO optimization_results
      (
        shipment_id,
        space_utilisation,
        weight_utilisation,
        opt_score
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        shipment_id,
        space_utilisation,
        weight_utilisation,
        opt_score
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = 3000;

app.post("/api/results", async (req, res) => {
  try {

    const {
      shipment_id,
      space_utilisation,
      weight_utilisation,
      opt_score
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO optimization_results
      (
        shipment_id,
        space_utilisation,
        weight_utilisation,
        opt_score
      )
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [
        shipment_id,
        space_utilisation,
        weight_utilisation,
        opt_score
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message
    });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

