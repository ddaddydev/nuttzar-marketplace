export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'ValidationError';
  }
}

export class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class InsufficientFundsError extends AppError {
  constructor() {
    super(402, 'Insufficient credits');
    this.name = 'InsufficientFundsError';
  }
}

export class ConcurrentModificationError extends AppError {
  constructor() {
    super(409, 'Concurrent modification — please retry');
    this.name = 'ConcurrentModificationError';
  }
}

export class GameSessionError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'GameSessionError';
  }
}
