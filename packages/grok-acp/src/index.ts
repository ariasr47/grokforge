#!/usr/bin/env node
import { GrokAcpServer } from "./server.js";

const server = new GrokAcpServer();
server.start();
