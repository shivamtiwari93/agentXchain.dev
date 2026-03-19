property projectRoot : ""
property pollSeconds : 3
property autoSend : false

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
            my nudgeAgent(agentId, turnNum)
            do shell script "printf %s " & quoted form of dispatchKey & " > " & quoted form of statePath
          end if
        end if
      end if
    end try

    delay pollSeconds
  end repeat
end run

on nudgeAgent(agentId, turnNum)
  set nudgeText to "Hey " & agentId & ", it is your turn now (turn " & turnNum & "). Read lock.json, claim the lock, check state.md + history.jsonl + planning docs, do your work, and release lock."
  set the clipboard to nudgeText

  tell application "Cursor" to activate
  delay 0.5
  my focusAgentWindow(agentId)
  delay 0.2

  tell application "System Events"
    if not (exists process "Cursor") then return

    tell process "Cursor"
      set frontmost to true
      keystroke "l" using {command down}
      delay 0.2
      keystroke "v" using {command down}
      if autoSend then
        delay 0.15
        key code 36
      end if
    end tell
  end tell

  do shell script "osascript -e " & quoted form of ("display notification \"Nudged " & agentId & " for turn " & turnNum & "\" with title \"AgentXchain\"")
end nudgeAgent

on focusAgentWindow(agentId)
  tell application "System Events"
    if not (exists process "Cursor") then return
    tell process "Cursor"
      set frontmost to true

      set didRaise to false
      repeat with w in windows
        try
          set wn to name of w as text
          if wn contains agentId then
            perform action "AXRaise" of w
            set didRaise to true
            exit repeat
          end if
        end try
      end repeat

      if didRaise is false then
        try
          perform action "AXRaise" of window 1
        end try
      end if
    end tell
  end tell
end focusAgentWindow
