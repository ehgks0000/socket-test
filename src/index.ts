import http from "http";
import "module-alias/register";
import { Server, Socket } from "socket.io";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import * as redis from "redis";
import PrismaClient from "./db";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import { PORT, REDIS_URL, CLIENT_URL } from "./config";
import { Rooms } from "@prisma/client";
import { asyncHandler } from "./lib/async-handler";
import { errorHandler } from "./lib/error-handler";

const main = async () => {
    const client = redis.createClient({ url: REDIS_URL });
    client.on("error", (err) => console.log("Redis Client Error", err));
    await client.connect();

    const app = express();

    app.use(
        cors({
            origin: CLIENT_URL,
            // origin: "*",
            credentials: true
        })
    );

    // app.use((req, res, next) => {
    //   const user = req.headers.authorization;
    //   if (!user) {
    //     next(new Error());
    //     return;
    //   }
    //   next();
    // });

    app.get("/ping", (req, res) => {
        res.send("pong");
    });

    // 유저 생성

    app.get(
        "/user/create",
        asyncHandler(async (req, res) => {
            const name = req.query.name;
            if (!name) throw new Error("No name");

            const user = await PrismaClient.users.create({
                data: {
                    name: name as string
                }
            });

            res.json({ user });
        })
    );

    // 특정 채팅방의 정보와 채팅방의 채팅내역
    app.get("/room/:id", async (req, res) => {
        const _id = req.params.id;
        if (!_id) {
            throw new Error("No Id");
        }
        const roomWithChats = await PrismaClient.rooms.findUnique({
            where: {
                id: Number(_id)
            },
            include: {
                // 채팅 내역
                chats: {
                    orderBy: {
                        createdAt: "desc"
                    },
                    take: 20
                }
            }
        });
        console.log("roomWithChats :", roomWithChats);
        res.json({ data: { roomWithChats } });
    });

    // 유저가 참여한.
    // 최신 순 채팅방 리스트와 각 채팅방의 채팅 내역 조회.
    // header에 유저 정보가 들어 온다고 가정
    app.get("/user/:id/room", async (req, res) => {
        const _id = req.params.id;
        if (!_id) {
            throw new Error("No user Id");
        }

        const id = Number(_id);
        if (!id) {
            throw new Error("Not a Number");
        }

        const roomListWithLastChat = await PrismaClient.usersOnRooms.findMany({
            where: {
                userId: id
            },
            orderBy: [{ room: { updatedAt: "desc" } }, { room: { createdAt: "desc" } }],
            select: {
                room: {
                    select: {
                        id: true,
                        createdAt: true,
                        title: true,
                        chats: {
                            select: {
                                message: true,
                                createdAt: true
                            },
                            orderBy: {
                                createdAt: "desc"
                            },
                            take: 1
                        }
                    }
                }
            }
            // 가장 최신의 댓글을 가지는 room을 위로.
        });

        console.log("roomList :", roomListWithLastChat);
        res.json({ roomListWithLastChat });
    });

    // room chatting
    app.get(
        "/chat/user/:id/room/:roomId",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            const _roomId = req.params.roomId;

            if (!_id || !_roomId) {
                throw new Error("No Id");
            }

            const id = Number(_id);
            const roomId = Number(_roomId);

            if (!id || !roomId) {
                throw new Error("Not a Number");
            }

            // @TODO 하드코딩.
            const message = (req.query.message as string) || "msg";

            const chat = await PrismaClient.chats.create({
                data: {
                    roomId,
                    authorId: id,
                    message
                }
            });
            res.json({ chat });
        })
    );

    // create dm / 보낼 때
    app.get(
        "/user/:id/dm/:receiverId",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            const _receiverId = req.params.receiverId;

            if (!_id || !_receiverId) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            const receiverId = Number(_receiverId);

            const message = (req.query.message as string) || "msg";

            if (!id || !receiverId) {
                throw new Error("Not a Number");
            }

            const dm = await PrismaClient.dms.create({
                data: {
                    senderId: id,
                    receiverId: receiverId,
                    message
                }
            });
            res.json({ dm });
        })
    );

    // get dms
    app.get(
        "/user/:id/dms/:receiverId",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            const _receiverId = req.params.receiverId;

            if (!_id || !_receiverId) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            const receiverId = Number(_receiverId);

            if (!id || !receiverId) {
                throw new Error("Not a Number");
            }

            const dms = await PrismaClient.dms.findMany({
                where: {
                    OR: [
                        {
                            senderId: id,
                            receiverId
                        },
                        { senderId: receiverId, receiverId: id }
                    ]
                },
                orderBy: { createdAt: "desc" },
                take: 20

                // @TODO cursor based pagination 구현할 때 사용.
                // skip: 1,
                // cursor: {
                //   id: 1,
                // },
            });

            res.json({ dms });
        })
    );

    // create room chat / 방 생성
    app.get(
        "/user/:id/room/create",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;

            if (!_id) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            if (!id) {
                throw new Error("Not a Number :userId");
            }

            // @TODO 하드코딩.
            const title = (req.query.title as string) || "create-room";

            const room = await PrismaClient.rooms.create({
                data: {
                    ownerId: id,
                    title,
                    users: {
                        create: {
                            userId: id
                        }
                    }
                },
                include: {
                    users: true
                }
            });

            res.json({ room });
        })
    );

    // room chat 참여 // room 참여
    // 카카오톡 오픈 채팅 들어가는 순간 최근 댓글 같이 불러오기.
    app.get(
        "/user/:id/room/:roomId/join",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            const _roomId = req.params.roomId;

            if (!_id) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            if (!id) {
                throw new Error("Not a Number :userId");
            }

            if (!_roomId) {
                throw new Error("No Id");
            }
            const roomId = Number(_roomId);
            if (!roomId) {
                throw new Error("Not a Number :roomId");
            }

            const room = await PrismaClient.rooms.findUnique({
                // room Id
                where: { id: roomId },
                include: { chats: { orderBy: { createdAt: "desc" }, take: 20 } }
            });

            if (!room) {
                throw new Error("No Room");
            }

            let usersOnRoom = await PrismaClient.usersOnRooms.findUnique({
                where: {
                    userId_roomId: {
                        userId: id,
                        roomId: room.id
                    }
                }
            });

            if (!usersOnRoom) {
                console.log("usersOnRoom 생성.");
                usersOnRoom = await PrismaClient.usersOnRooms.create({
                    data: {
                        userId: id,
                        roomId: room.id
                    }
                });
            }

            res.json({ room, usersOnRoom });
        })
    );

    // add-following
    app.get(
        "/test/following",
        asyncHandler(async (req, res) => {
            const following = await PrismaClient.follows.create({
                data: {
                    // 내가 2번 유저를 팔로잉

                    // 내 아이디
                    followerId: 1,
                    // 상대 아이디
                    followingId: 2
                }
            });

            res.json({ following });
        })
    );

    // delete-following

    app.get(
        "/test/following-d",
        asyncHandler(async (req, res) => {
            const following = await PrismaClient.follows.delete({
                // 내 팔로잉 삭제
                where: {
                    followerId_followingId: {
                        // 상대 아이디
                        followingId: 2,
                        // 내 아이디
                        followerId: 1
                    }
                }
            });
            res.json({ following });
        })
    );

    // delete-follower
    app.get(
        "/test/follower-d",
        asyncHandler(async (req, res) => {
            const follower = await PrismaClient.follows.delete({
                where: {
                    // 내 팔로워 삭제
                    followerId_followingId: {
                        // 상대 아이디
                        followerId: 2,

                        // 내 아이디
                        followingId: 1
                    }
                }
            });
            res.json({ follower });
        })
    );

    // 전체 Rooms List With Pagination
    // 카카오톡 오픈채팅 찾는 느낌.
    app.get(
        "/rooms",
        asyncHandler(async (req, res) => {
            const _take = req.query.take;
            const take = Number(_take) || 20;
            const _cursor = req.query.cursor;

            const rooms = await PrismaClient.rooms.findMany({
                where: {},
                select: {
                    id: true,
                    title: true,
                    // 채팅방 생성일자
                    createdAt: true,
                    // 수정된 일자 -> 가장 최근 활동 시간 / 되나?.
                    updatedAt: true,
                    // 채팅방의 가장 최근 활동 시간
                    chats: {
                        select: {
                            message: true,
                            createdAt: true
                        },
                        orderBy: {
                            createdAt: "desc"
                        },
                        take: 1
                    },
                    // 참여 중인 유저 수
                    _count: {
                        select: {
                            users: true
                        }
                    }
                },
                take,
                ...(_cursor && {
                    // ref
                    // https://www.prisma.io/docs/concepts/components/prisma-client/pagination#do-i-always-have-to-skip-1
                    skip: 1,
                    cursor: { id: Number(_cursor) }
                })
            });
            res.json({ rooms });
        })
    );

    // get Room by Title
    app.get(
        "/room",
        asyncHandler(async (req, res) => {
            const title = (req.query.title as string) || "this-is-title";
            // if (!title) {
            //   throw new Error("No Title");
            // }
            const rooms = await PrismaClient.rooms.findMany({
                where: {
                    title
                },
                select: {
                    id: true,
                    title: true,
                    // 채팅방 생성일자
                    createdAt: true,
                    // 수정된 일자 -> 가장 최근 활동 시간 / 되나?.
                    updatedAt: true,
                    chats: {
                        select: {
                            createdAt: true
                        },
                        orderBy: {
                            createdAt: "desc"
                        },
                        take: 1
                    },
                    // 참여 중인 유저 수
                    _count: {
                        select: {
                            users: true
                        }
                    }
                }
            });
            res.json({ rooms });
        })
    );

    // get Room by id
    app.get(
        "/room-id/:id",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            if (!_id) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            if (!id) {
                throw new Error("Not a Number");
            }

            const room = await PrismaClient.rooms.findUnique({
                where: {
                    id
                },
                select: {
                    id: true,
                    title: true,
                    owner: true,
                    chats: {
                        orderBy: {
                            createdAt: "desc"
                        },
                        take: 1
                    },
                    // 참여 중인 유저 수
                    _count: {
                        select: {
                            users: true
                        }
                    }
                }
            });
            res.json({ room });
        })
    );

    // get user List of Room by roomId
    app.get(
        "/room/:id/users",
        asyncHandler(async (req, res) => {
            const _id = req.params.id;
            if (!_id) {
                throw new Error("No Id");
            }
            const id = Number(_id);
            if (!id) {
                throw new Error("Not a Number");
            }

            // 방 들어온 최신순 유저 목록
            const rooms = await PrismaClient.usersOnRooms.findMany({
                where: {
                    roomId: id
                },
                orderBy: { createdAt: "desc" }
            });

            // const rooms = await PrismaClient.rooms.findUnique({
            //   where: { id },
            //   select: {
            //     users: { select: { user: true } },
            //   },
            // });
            res.json({ rooms: rooms });
        })
    );

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
        cors: {
            origin: CLIENT_URL,
            // origin: "*",
            credentials: true
        }
    });

    const getFollowerFollowingList = async (userId: number, prismaClient: typeof PrismaClient) => {
        const followings = prismaClient.follows.findMany({
            where: { followingId: userId },
            // select: { friendId: true },
            orderBy: { createdAt: "desc" }
        });

        const followers = prismaClient.follows.findMany({
            where: { followerId: userId },
            // select: { userId: true },
            orderBy: { createdAt: "desc" }
        });

        return Promise.all([followings, followers]).then(([followings, followers]) => {
            const followingList = followings.map(({ followingId }) => followingId);
            const followerList = followers.map(({ followerId }) => followerId);

            return [...new Set([...followingList, ...followerList])];
        });
    };

    const tellMyStatusToFriend = async (list: string[], socket: Socket, userId: string, event: string = "is-online") => {
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
    };

    io.use((socket, next) => {
        const userId = socket.handshake.headers.authorization;
        if (!userId) {
            next(new Error("No User"));
            return;
        }
        next();
    });

    // 로그인 유저의 방 리스트 목록과 각 방의 최신 chat 조회.
    io.on("connection", async (socket) => {
        // @TODO 하드코딩 나중에 수정
        const userId = socket.handshake.headers.authorization!;
        console.log("userId:", userId);

        const list = await getFollowerFollowingList(Number(userId), PrismaClient);
        console.log("list :", list);

        // 팔로워, 팔로잉 리스트에서 online인 유저에게만 로그인 상태 emit
        // @TODO
        await tellMyStatusToFriend(list as any[], socket, userId, "is-online");

        // 채팅방 리스트 조회
        let roomList: Rooms[] = [];
        try {
            const userRooms = await PrismaClient.usersOnRooms.findMany({
                where: {
                    userId: Number(userId)
                    // room: {},
                },
                select: {
                    room: {
                        select: {
                            title: true,
                            createdAt: true,
                            updatedAt: true,
                            chats: {
                                orderBy: { createdAt: "desc" },
                                take: 1
                            }
                        }
                    }
                }
            });
            console.log("userRooms :", userRooms);
            // if (userWithRooms?.rooms) {
            //   roomList = userWithRooms.rooms;
            // }
        } catch (error) {
            console.log("err1 :", error);
            return;
        }

        console.log("roomList :", roomList);
        socket.emit("room-list", { roomList });

        await client.hSet(userId, ["status", "online", "last_activated_at", new Date().toISOString(), "socketId", socket.id]);

        // socket.on("create_room", ({}) => {

        // });

        // 참여하고 있는 채팅방에 들어 가는 것
        // 미참여하고 있는 채팅방에 처음 들어 가는 것 -> api로 접속해야하나?
        // 아니면 이벤트명을 분리 ?
        socket.on("join", async ({ roomId }) => {
            console.log("join to :", roomId);

            if (!roomId) {
                console.log("No (roomId) data");
                return;
            }
            const room = await PrismaClient.rooms.findUnique({
                where: {
                    id: roomId
                }
            });

            if (!room) {
                console.log("No Room");
                return;
            }

            const chats = await PrismaClient.chats.findMany({
                where: { roomId: roomId },
                orderBy: {
                    createdAt: "desc"
                },
                take: 10
            });

            socket.emit("join", { chats });
        });

        socket.on("register", async ({ name }) => {
            try {
                await PrismaClient.users.create({
                    data: {
                        name
                    }
                });
            } catch (error) {
                console.log("error :", error);
            }
        });

        socket.on("add-following", async ({ followingId }) => {
            if (followingId === userId) {
                console.log("자기 자신 팔로잉 안됍니다.");
                return;
            }
            try {
                await PrismaClient.follows.create({
                    data: {
                        // @TODO 하드코딩 나중에 수정
                        followerId: userId as unknown as number,
                        followingId
                    }
                });
            } catch (error) {
                if (error instanceof PrismaClientKnownRequestError) {
                    if (error.code === "P2002") {
                        console.log(`${error?.meta?.target} is Duplicate`);
                    }
                }
            }
        });

        socket.on("delete-following", async ({ followingId }) => {
            try {
                await PrismaClient.follows.delete({
                    where: {
                        followerId_followingId: {
                            //   // @TODO 하드코딩 나중에 수정
                            followerId: userId as unknown as number,
                            followingId
                        }
                    }
                });
            } catch (error) {
                console.log(error);
                return;
            }
        });

        socket.on("dm", async (data: { roomId: number; to: string; msg: string }) => {
            console.log("dm 들어옴 :", data);
            const { roomId, to, msg } = data;
            try {
                const dm = await PrismaClient.dms.create({
                    data: {
                        message: msg,

                        // @TODO 하드코딩.
                        senderId: 1,
                        receiverId: 2
                    }
                });
            } catch (error) {
                // @TODO socket io의 에러 헨들링 어떻게?
                console.log(error);
                return;
            }
            const userStatuss = await client.hGet(to, "status");
            if (!userStatuss) {
                console.log("No User");
                return;
                // throw new Error("No User");
            }
            if (userStatuss === "offline") {
                console.log("User is offline");
                return;
            }

            const socketId = await client.hGet(to, "socketId");

            if (!socketId) {
                // throw new Error("No socketId");
                console.log("No socketId");
                return;
            }

            socket.to(socketId).emit("dm", {
                from: userId,
                to: socketId,
                msg
            });
        });

        socket.on("disconnect", async (reason) => {
            console.log("연결 끊김", socket.id, reason);

            const list = await getFollowerFollowingList(Number(userId), PrismaClient);
            console.log("list :", list);

            // 팔로워, 팔로잉 리스트에서 online인 유저에게만 로그인 상태 emit
            await tellMyStatusToFriend(list as any[], socket, userId, "is-offline");

            client.hSet(userId, ["status", "offline"]);
        });

        socket.on("error", (err) => {
            console.log("err :", err);
        });
    });

    app.use(errorHandler);
    // io.use((socket, next) => {});

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
