#!/bin/bash
while true
do
  nc snapserver.local 42421 2>/dev/null
  sleep 5
done
