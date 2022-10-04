import http from "http";
import { Server, Socket } from "socket.io";
import express from "express";
import cors from "cors";
import * as redis from "redis";
import PrismaClient from "./db";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime";

const PORT = 3000;

const main = async () => {
  const client = redis.createClient({ url: "redis://localhost:6378" });
  client.on("error", (err) => console.log("Redis Client Error", err));
  await client.connect();

  const app = express();
  const corsURL = "http://localhost:5500";
  // const corsURL = "http://127.0.0.1:5500";

  app.use(
    cors({
      origin: corsURL,
      // origin: "*",
      credentials: true,
    })
  );

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: corsURL,
      // origin: "*",
      credentials: true,
    },
  });

  const getFollowerFollowingList = async (
    userId: string,
    prismaClient: typeof PrismaClient
    // prismaClient: TypePrismaClient
  ) => {
    const followings = prismaClient.friends.findMany({
      where: { userId },
      select: { friendId: true },
      orderBy: { createdAt: "desc" },
    });

    const followers = prismaClient.friends.findMany({
      where: { friendId: userId },
      select: { userId: true },
      orderBy: { createdAt: "desc" },
    });

    return Promise.all([followings, followers]).then(
      ([followings, followers]) => {
        const followingList = followings.map(({ friendId }) => friendId);
        const followerList = followers.map(({ userId }) => userId);

        return [...new Set([...followingList, ...followerList])];
      }
    );
  };

  const tellMyStatusToFriend = async (
    list: string[],
    socket: Socket,
    userId: string,
    event: string = "is-online"
  ) => {
    // function test(list: string) {
    //   return new Promise((resolve, reject) => {
    //     const status = client.hGet(list, "status");
    //   });
    // }
    for (const l of list) {
      const status = await client.hGet(l, "status");

      if (status && status === "online") {
        const socketId = await client.hGet(l, "socketId");

        if (!socketId) {
          continue;
        }

        socket.to(socketId).emit(event, { userId });
      }
    }
    // list.map();

    // return Promise.all([...list]);
  };

  io.on("connection", async (socket) => {
    const userId = socket.handshake.headers.authorization;
    if (!userId) {
      throw new Error("No User");
    }

    const list = await getFollowerFollowingList(userId, PrismaClient);
    console.log("list :", list);

    // 팔로워, 팔로잉 리스트에서 online인 유저에게만 로그인 상태 emit
    await tellMyStatusToFriend(list, socket, userId, "is-online");

    await client.hSet(userId, [
      "status",
      "online",
      "last_activated_at",
      new Date().toISOString(),
      "socketId",
      socket.id,
    ]);
    // console.log("1 옴?");
    // client.hSet(userId, ["name", "lee", "pw", "asdfasdf"])

    // @TODO 접속 시 친구 목록에게 상태 전송
    // const friendList = await client.lRange(`friends:${userId}`, 0, -1);
    // console.log(userId, friendList);

    // for (const friendName of friendList) {
    //   const friendStatus = await client.hGet(friendName, "status");
    //   console.log(`${userId}의 친구 상태 : ${friendStatus}`);
    //   if (!friendStatus || friendStatus !== "online") {
    //     continue;
    //   }

    //   const friendSocketId = await client.hGet(friendName, "socketId");
    //   if (!friendSocketId) {
    //     throw new Error("No friendSocketId");
    //   }
    //   console.log("friendSocketId :", friendSocketId);
    //   socket.to(friendSocketId).emit("online", { userId });
    // }

    socket.on("add-friend", async ({ friendName }) => {
      //   console.log("add friend :", userId, friendName);

      if (userId === friendName) {
        console.log("자기 자신을 친구추가 불가능.");
        return;
      }
      try {
        await PrismaClient.friends.create({
          data: {
            userId,
            friendId: friendName,
          },
        });
      } catch (error) {
        if (error instanceof PrismaClientKnownRequestError) {
          if (error.code === "P2002") {
            console.log(`${error?.meta?.target} is Duplicate`);
          }
        }
      }
    });

    socket.on("dm", async (data: { from: string; to: string; msg: string }) => {
      console.log("dm 들어옴 :", data);
      const { from, to, msg } = data;

      // const userStatus = await client.get(to);
      const userStatuss = await client.hGet(to, "status");
      if (!userStatuss || userStatuss === "offline") {
        throw new Error("No User");
      }
      // const parsedUserStatus = JSON.parse(userStatus);

      const socketId = await client.hGet(to, "socketId");

      if (!socketId) {
        throw new Error("No socketId");
      }

      socket.to(socketId).emit("dm", {
        from: userId,
        to: socketId,
        msg,
      });
    });

    socket.on("disconnect", async (reason) => {
      console.log("연결 끊김", socket.id, reason);
      // const userStatus = {
      //     status: "offline"
      // }
      // await client.set(userId, JSON.stringify(userStatus));

      const list = await getFollowerFollowingList(userId, PrismaClient);
      console.log("list :", list);

      // 팔로워, 팔로잉 리스트에서 online인 유저에게만 로그인 상태 emit
      await tellMyStatusToFriend(list, socket, userId, "is-offline");

      //   socket.broadcast.emit("is-offline", { userId });
      //   io.sockets.emit("is-offline", { userId });
      client.hSet(userId, ["status", "offline"]);

      // @TODO 접속 시 친구 목록에게 상태 전송
      // 나는 팔로우 안했지만 나를 팔로우한 유저에게 전송 어떻게?
      //   const friendList = await client.lRange(`friends:${userId}`, 0, -1);
      //   console.log(userId, friendList);

      //   for (const friendName of friendList) {
      //     const friend = await client.get(friendName);
      //     console.log(`${userId}의 친구 상태 : ${friend}`);
      //     if (!friend) {
      //       continue;
      //     }
      //     const parsedFriend = JSON.parse(friend);
      //     if (parsedFriend && parsedFriend.status === "online") {
      //       console.log("로그인 중인 친구 :", friendName);
      //       // console.log("로그인 중인 친구 :", friend, parsedFriend)
      //       socket.to(parsedFriend.socketId).emit("offline", { userId });
      //     }
      //   }
    });
  });

  return httpServer;
};

if (require.main === module) {
  (async () => {
    const app = await main();

    app.listen(PORT, () => {
      console.log("Server Open");
    });
  })();
}
