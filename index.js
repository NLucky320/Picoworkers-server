const express = require("express");
const app = express();
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
//middleware
//Must remove "/" from your production URL
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.znfmgop.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    const userCollection = client.db("picoworker").collection("users");
    const tasksCollection = client.db("picoworker").collection("tasks");
    const paymentCollection = client.db("picoworker").collection("payments");
    const submissionCollection = client
      .db("picoworker")
      .collection("submission");
    const withdrawCollection = client.db("picoworker").collection("withdraw");
    const buyCoinsCollection = client.db("picoworker").collection("buyCoins");
    const notificationCollection = client
      .db("picoworker")
      .collection("notification");
    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });
    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log("inside verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    //user collection
    app.put("/users", async (req, res) => {
      const user = req.body;
      //install email if the user doesnot exist:
      //can do this by (1. email unique, 2. upsert, 3.simple checking)
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist", insertedId: null });
      }
      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await userCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      // console.log(req.headers);
      const result = await userCollection.find().toArray();
      res.send(result);
    });
    // get a user info by email from db
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send(result);
    });

    app.get("/userStats", async (req, res) => {
      try {
        const users = await userCollection.find().toArray();
        const totalUsers = users.length;
        const totalCoins = users.reduce(
          (sum, user) => sum + (user.coins || 0),
          0
        );

        res.send({ totalUsers, totalCoins });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch user stats", error });
      }
    });
    //update a user role
    app.patch("/users/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    app.delete("/users/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const result = await userCollection.deleteOne({ email });
        if (result.deletedCount === 1) {
          res.send({ message: "User successfully deleted" });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal server error", error });
      }
    });

    // get a admin info by email from db
    // app.get("/users/admin/:email", verifyToken, async (req, res) => {
    //   const email = req.params.email;

    //   if (email !== req.decoded.email) {
    //     return res.status(403).send({ message: "forbidden access" });
    //   }

    //   const query = { email: email };
    //   const user = await userCollection.findOne(query);
    //   let admin = false;
    //   if (user) {
    //     admin = user?.role === "admin";
    //   }
    //   res.send({ admin });
    // });

    //task collections
    // Save a tasks data in db
    // app.post("/tasks", async (req, res) => {
    //   const taskData = req.body;
    //   taskData.createdAt = new Date();
    //   const result = await tasksCollection.insertOne(taskData);
    //   res.send(result);
    // });
    app.post("/tasks", async (req, res) => {
      const taskData = req.body;
      const creatorEmail = taskData.taskCreator.email;
      const taskAmount = taskData.price;

      try {
        // Start a session for transaction
        const session = client.startSession();
        session.startTransaction();

        // Insert the task data
        const taskResult = await tasksCollection.insertOne(taskData, {
          session,
        });

        // Update the user's coin balance
        const userUpdateResult = await userCollection.updateOne(
          { email: creatorEmail },
          { $inc: { coins: -taskAmount } }, // Deduct the coins by task amount
          { session }
        );

        if (userUpdateResult.modifiedCount !== 1) {
          throw new Error("Failed to update user's coins");
        }

        // Commit the transaction
        await session.commitTransaction();
        session.endSession();

        res.send({
          message: "Task created and coins deducted",
          taskId: taskResult.insertedId,
        });
      } catch (error) {
        console.error("Task creation failed", error);
        res.status(500).send({ message: "Task creation failed", error });
      }
    });

    // Get all tasks from db
    app.get("/tasks", async (req, res) => {
      const result = await tasksCollection.find().toArray();
      res.send(result);
    });
    // Get one tasks from db
    app.get("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await tasksCollection.findOne(query);
      res.send(result);
    });

    app.get("/myTask/:email", async (req, res) => {
      const email = req.params.email;
      const query = { "taskCreator.email": email };
      const options = {
        sort: { createdAt: -1 }, // Sort by createdAt in descending order
      };
      const result = await tasksCollection.find(query, options).toArray();
      res.send(result);
    });
    // app.delete("/tasks/:id", async (req, res) => {
    //   const id = req.params.id;
    //   const query = { _id: new ObjectId(id) };
    //   const result = await tasksCollection.deleteOne(query);
    //   res.send(result);
    // });

    app.delete("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const { taskCreatorEmail, taskQuantity, payableAmount } = req.body;

      const session = client.startSession();
      try {
        session.startTransaction();

        // Delete the task
        const taskDeletionResult = await tasksCollection.deleteOne(
          { _id: new ObjectId(id) },
          { session }
        );

        // Calculate the total coins to be added
        const coinsToAdd = taskQuantity * payableAmount;

        // Increment the task creator's coins
        const userUpdateResult = await userCollection.updateOne(
          { email: taskCreatorEmail },
          { $inc: { coins: coinsToAdd } },
          { session }
        );

        if (
          taskDeletionResult.deletedCount === 1 &&
          userUpdateResult.modifiedCount === 1
        ) {
          await session.commitTransaction();
          res.send({ message: "Task deleted and coins updated successfully" });
        } else {
          throw new Error("Task deletion or coin update failed");
        }
      } catch (error) {
        await session.abortTransaction();
        res.status(500).send({ message: "Task deletion failed", error });
      } finally {
        session.endSession();
      }
    });

    app.put("/tasks/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedTask = req.body;
      const task = {
        $set: {
          detail: updatedTask.detail,
          title: updatedTask.title,
          info: updatedTask.info,
        },
      };
      const result = await tasksCollection.updateOne(filter, task, options);
      res.send(result);
    });
    app.patch("/tasks/:id/decreaseQuantity", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      try {
        const task = await tasksCollection.findOne(query);
        if (task.quantity > 0) {
          const updateDoc = { $inc: { quantity: -1 } };
          const result = await tasksCollection.updateOne(query, updateDoc);
          res.send(result);
        } else {
          res.status(400).send({ message: "Quantity cannot be less than 0" });
        }
      } catch (error) {
        res.status(500).send({ message: "Failed to decrease quantity", error });
      }
    });

    //submission collection
    // app.post("/submission", async (req, res) => {
    //   const submissionData = req.body;
    //   const result = await submissionCollection.insertOne(submissionData);
    //   res.send(result);
    // });

    app.post("/submission", async (req, res) => {
      const submissionData = req.body;
      const workerEmail = submissionData.worker_email;
      const payableAmount = submissionData.payable_amount;

      try {
        // Insert the submission data
        const submissionResult = await submissionCollection.insertOne(
          submissionData
        );

        // Update the worker's coin balance
        const updateResult = await userCollection.updateOne(
          { email: workerEmail },
          { $inc: { coins: payableAmount } } // Increment the coins by payable amount
        );

        if (updateResult.modifiedCount === 1) {
          res.send({
            message: "Submission successful and coins updated",
            submissionId: submissionResult.insertedId,
          });
        } else {
          res.status(500).send({ message: "Failed to update worker's coins" });
        }
      } catch (error) {
        console.error("Submission failed", error);
        res.status(500).send({ message: "Submission failed", error });
      }
    });

    app.get("/submission", async (req, res) => {
      const result = await submissionCollection.find().toArray();
      res.send(result);
    });

    app.patch("/submission/:id", async (req, res) => {
      const submissionId = req.params.id;
      const { status } = req.body;

      try {
        const query = { _id: new ObjectId(submissionId) };
        const update = { $set: { status } };
        const result = await submissionCollection.updateOne(query, update);
        res.send(result);
      } catch (error) {
        console.error("Error updating submission status:", error);
        res
          .status(500)
          .send({ message: "Failed to update submission status", error });
      }
    });
    app.get("/mySubmission/:email", async (req, res) => {
      const email = req.params.email;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      try {
        const submissions = await submissionCollection
          .find({ worker_email: email })
          .skip(skip)
          .limit(limit)
          .toArray();
        const totalSubmissions = await submissionCollection.countDocuments({
          worker_email: email,
        });
        const totalPages = Math.ceil(totalSubmissions / limit);

        res.send({
          submissions,
          totalPages,
          currentPage: page,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch submissions", error });
      }
    });

    app.get("/myWork/:email", async (req, res) => {
      const email = req.params.email;
      const query = { taskCreator_email: email };
      const options = {
        sort: { createdAt: -1 }, // Sort by createdAt in descending order
      };
      const result = await submissionCollection.find(query, options).toArray();
      res.send(result);
    });
    // app.get("/mySubmission/:email", async (req, res) => {
    //   const email = req.params.email;
    //   const query = { worker_email: email, status: "approved" }; // Filter for approved submissions
    //   const options = {
    //     sort: { createdAt: -1 }, // Sort by createdAt in descending order
    //   };
    //   const result = await submissionCollection.find(query, options).toArray();
    //   res.send(result);
    // });
    app.get("/approvedSubmissions/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const result = await submissionCollection
          .find({
            worker_email: email,
            status: "approved",
          })
          .toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch approved submissions", error });
      }
    });

    app.get("/submissionCount/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const count = await submissionCollection.countDocuments({
          worker_email: email,
        });
        res.send({ count });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch submission count", error });
      }
    });

    //withdraw collection
    app.get("/withdraw", async (req, res) => {
      const result = await withdrawCollection.find().toArray();
      res.send(result);
    });

    app.post("/withdraw", async (req, res) => {
      const withdrawData = req.body;
      withdrawData.createdAt = new Date();
      const result = await withdrawCollection.insertOne(withdrawData);
      res.send(result);
    });

    app.post("/withdraw/complete", async (req, res) => {
      const { withdrawId, workerEmail, withdrawCoin } = req.body;

      const session = client.startSession();
      try {
        session.startTransaction();

        // Delete the withdrawal request
        const deleteResult = await withdrawCollection.deleteOne(
          { _id: new ObjectId(withdrawId) },
          { session }
        );

        // Deduct coins from the user's account
        const updateResult = await userCollection.updateOne(
          { email: workerEmail },
          { $inc: { coins: -withdrawCoin } },
          { session }
        );

        if (
          deleteResult.deletedCount !== 1 ||
          updateResult.modifiedCount !== 1
        ) {
          throw new Error("Failed to complete the withdrawal process");
        }

        await session.commitTransaction();
        res.send({
          success: true,
          message: "Withdrawal completed successfully",
        });
      } catch (error) {
        await session.abortTransaction();
        res.status(500).send({ success: false, message: error.message });
      } finally {
        session.endSession();
      }
    });

    app.get("/buy", async (req, res) => {
      const result = await buyCoinsCollection.find().toArray();
      res.send(result);
    });
    app.get("/buy/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await buyCoinsCollection.findOne(query);
      res.send(result);
    });

    //payment related api

    //payment-intent
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      if (!price || isNaN(price)) {
        return res.status(400).send({ error: "Invalid price value" });
      }
      const amount = parseInt(price * 100);
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);
      console.log("payment info", payment);
      res.send({ paymentResult });
    });
    app.get("/payments", async (req, res) => {
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });
    app.get("/payments/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("micropicker is sitting");
});

app.listen(port, () => {
  console.log(`micropicker is running on port ${port} `);
});
