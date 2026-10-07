// keywatch: listen-only キー監視ヘルパー。
// Cmd+C の押下と、その結果 NSPasteboard の changeCount が変わったかを JSON Lines で stdout に出す。
// キー入力は一切奪わない・遅延させない (.listenOnly)。
import Cocoa
import ApplicationServices

setbuf(stdout, nil)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

let keyC: Int64 = 8
var tapRef: CFMachPort?
var copyId = 0

func watchPasteboard(id: Int, before: Int) {
    // コピー完了を最大 ~400ms 待つ。アプリによって書き込みが遅れるため。
    let deadline = nowMs() + 400
    func poll() {
        if NSPasteboard.general.changeCount != before {
            emit(["type": "copied", "id": id, "changed": true])
        } else if nowMs() >= deadline {
            emit(["type": "copied", "id": id, "changed": false])
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(20), execute: poll)
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(20), execute: poll)
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = tapRef { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    guard type == .keyDown else { return Unmanaged.passUnretained(event) }

    let code = event.getIntegerValueField(.keyboardEventKeycode)
    let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    let flags = event.flags
    let onlyCommand = flags.contains(.maskCommand)
        && !flags.contains(.maskShift) && !flags.contains(.maskAlternate) && !flags.contains(.maskControl)

    if code == keyC && onlyCommand {
        if !isRepeat {
            copyId += 1
            let id = copyId
            let before = NSPasteboard.general.changeCount
            emit(["type": "copy", "id": id, "t": nowMs()])
            watchPasteboard(id: id, before: before)
        }
    } else if !isRepeat {
        emit(["type": "key", "code": code, "t": nowMs()])
    }
    return Unmanaged.passUnretained(event)
}

if !CGPreflightListenEventAccess() {
    _ = CGRequestListenEventAccess()
}

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
    callback: callback,
    userInfo: nil
) else {
    emit(["type": "error", "code": "no-permission"])
    exit(2)
}

tapRef = tap
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit(["type": "ready"])
CFRunLoopRun()
