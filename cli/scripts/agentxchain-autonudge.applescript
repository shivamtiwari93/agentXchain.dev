property projectRoot : ""
property pollSeconds : 3
property autoSend : false
property lastFailedDispatch : ""

on run argv
  if (count of argv) < 1 then
    error "Usage: osascript agentxchain-autonudge.applescript <projectRoot> [autoSend:true|false] [pollSeconds]"
  end if

  set projectRoot to item 1 of argv

  if (count of argv) >= 2 then
    set sendArg to item 2 of argv
    if sendArg is "true" then
      set autoSend to true
    else
      set autoSend to false
    end if
  end if

  if (count of argv) >= 3 then
    try
      set pollSeconds to (item 3 of argv) as integer
    on error
      set pollSeconds to 3
    end try
  end if

  set triggerPath to projectRoot & "/.agentxchain-trigger.json"
  set statePath to projectRoot & "/.agentxchain-autonudge.state"

  repeat
    try
      set hasTrigger to do shell script "test -f " & quoted form of triggerPath & " && echo yes || echo no"
      if hasTrigger is "yes" then
        set agentId to do shell script "jq -r '.agent // empty' " & quoted form of triggerPath
        set turnNum to do shell script "jq -r '.turn_number // 0' " & quoted form of triggerPath

        if agentId is not "" then
          set dispatchKey to agentId & ":" & turnNum
          set lastKey to do shell script "test -f " & quoted form of statePath & " && cat " & quoted form of statePath & " || echo ''"

          if dispatchKey is not lastKey then
            set nudgedOk to my nudgeAgent(agentId, turnNum, dispatchKey)
            if nudgedOk then
              do shell script "printf %s " & quoted form of dispatchKey & " > " & quoted form of statePath
            end if
          end if
        end if
      end if
    end try

    delay pollSeconds
  end repeat
end run

on nudgeAgent(agentId, turnNum, dispatchKey)
  set nudgeText to "Hey " & agentId & ", it is your turn now (turn " & turnNum & "). Read lock.json, claim the lock, check state.md + history.jsonl + planning docs, do your work, and release lock."
  set the clipboard to nudgeText

  tell application "System Events"
    if not (exists process "Cursor") then
      if lastFailedDispatch is not dispatchKey then
        do shell script "osascript -e " & quoted form of ("display notification \"Cursor is not running.\" with title \"AgentXchain\"")
        set lastFailedDispatch to dispatchKey
      end if
      return false
    end if
  end tell

  tell application "Cursor" to activate
  delay 0.6

  -- Verify Cursor is actually frontmost before sending keystrokes
  tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    if frontApp is not "Cursor" then
      if lastFailedDispatch is not dispatchKey then
        do shell script "osascript -e " & quoted form of ("display notification \"Cursor lost focus, skipping nudge for " & agentId & ".\" with title \"AgentXchain\"")
        set lastFailedDispatch to dispatchKey
      end if
      return false
    end if
  end tell

  set focusedOk to my focusAgentWindow(agentId)
  if focusedOk is false then
    if lastFailedDispatch is not dispatchKey then
      do shell script "osascript -e " & quoted form of ("display notification \"Could not identify a unique window for " & agentId & ".\" with title \"AgentXchain\"")
      set lastFailedDispatch to dispatchKey
    end if
    return false
  end if
  delay 0.3

  -- Re-verify focus before keystrokes
  tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    if frontApp is not "Cursor" then
      return false
    end if

    tell process "Cursor"
      set frontmost to true
      keystroke "l" using {command down}
      delay 0.3
      keystroke "v" using {command down}
      if autoSend then
        delay 0.2
        key code 36
      end if
    end tell
  end tell

  set lastFailedDispatch to ""
  do shell script "osascript -e " & quoted form of ("display notification \"Nudged " & agentId & " for turn " & turnNum & "\" with title \"AgentXchain\"")
  return true
end nudgeAgent

on focusAgentWindow(agentId)
  tell application "System Events"
    if not (exists process "Cursor") then return
    tell process "Cursor"
      set frontmost to true

      set matchedIndexes to {}
      set idx to 0
      repeat with w in windows
        set idx to idx + 1
        try
          set wn to name of w as text
          if my isStrongWindowMatch(wn, agentId) then
            set end of matchedIndexes to idx
          end if
        end try
      end repeat

      if (count of matchedIndexes) = 1 then
        try
          set targetIndex to item 1 of matchedIndexes
          perform action "AXRaise" of window targetIndex
          return true
        end try
      else if (count of matchedIndexes) > 1 then
        return false
      end if
    end tell
  end tell
  return false
end focusAgentWindow

on isStrongWindowMatch(windowName, agentId)
  set tokenA to ".agentxchain-workspaces/" & agentId
  set tokenB to ".agentxchain-workspaces\\" & agentId
  set tokenC to agentId & ".code-workspace"
  if windowName contains tokenA then return true
  if windowName contains tokenB then return true
  if windowName contains tokenC then return true
  return false
end isStrongWindowMatch
