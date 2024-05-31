const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();
// const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
//middleware
//Must remove "/" from your production URL
app.use(
  cors({
    origin: ["http://localhost:5173"],
  })
);
app.use(express.json());
app.get("/", (req, res) => {
  res.send("micropicker is sitting");
});

app.listen(port, () => {
  console.log(`micropicker is running on port ${port} `);
});
