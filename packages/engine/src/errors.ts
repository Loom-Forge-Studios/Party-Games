/** Thrown by GameModule.reduce() on invalid input (illegal move, wrong actor, malformed action, etc). */
export class IllegalAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalAction';
    Object.setPrototypeOf(this, IllegalAction.prototype);
  }
}
