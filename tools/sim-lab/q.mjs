import pg from "pg"; const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres" }); await c.connect();
const r = await c.query(process.argv[2]); console.log(r.rows.map((x) => Object.values(x).join(" | ")).join("\n")); await c.end();
