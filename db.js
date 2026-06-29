const { Pool } = require("pg");

const pool = new Pool({
  user: "vedikabhoite",
  host: "localhost",
  database: "fcos",
  password: "",
  port: 5432,
});

module.exports = pool;