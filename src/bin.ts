#!/usr/bin/env node
import { ProposedFeatures, createConnection } from 'vscode-languageserver/node';
import { startServer } from './server.js';

startServer(
  createConnection(ProposedFeatures.all, process.stdin, process.stdout)
);
