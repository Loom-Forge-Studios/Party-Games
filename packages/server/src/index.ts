// STUB ONLY. Real server bootstrap (start ws server, wire net/rooms/host
// together) is Wave 1's job (A1/A2/A3). For now this just proves the
// package compiles and its subdirectories are wired up.

export * from './net/index.js';
export * from './rooms/index.js';
export * from './host/index.js';

console.log('[@party/server] stub entry — no real server yet (see packages/server/src/{net,rooms,host})');
