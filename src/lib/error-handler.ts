import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import type { NextFunction, Response, Request } from "express";

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res.status(409).json({ message: error?.meta?.target });
      return;
    }

    res.status(500).json({
      message: error.message,
    });

    return;
  }
  next(error);
};
