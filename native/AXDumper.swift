import Cocoa
import ApplicationServices

// Helper to convert AXValue to native types
func unwrapAXValue(_ value: AnyObject) -> Any? {
    if CFGetTypeID(value) == AXValueGetTypeID() {
        let type = AXValueGetType(value as! AXValue)
        switch type {
        case .cgPoint:
            var point = CGPoint.zero
            AXValueGetValue(value as! AXValue, type, &point)
            return ["x": point.x, "y": point.y]
        case .cgSize:
            var size = CGSize.zero
            AXValueGetValue(value as! AXValue, type, &size)
            return ["width": size.width, "height": size.height]
        case .cgRect:
            var rect = CGRect.zero
            AXValueGetValue(value as! AXValue, type, &rect)
            return ["x": rect.origin.x, "y": rect.origin.y, "width": rect.size.width, "height": rect.size.height]
        default:
            return nil
        }
    }
    return value
}

// Helper to get attribute value
func getAttribute(_ element: AXUIElement, _ attribute: CFString) -> Any? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    if result == .success, let v = value {
        return unwrapAXValue(v)
    }
    return nil
}

// Typed attribute helper
func attribute<T>(_ element: AXUIElement, _ attr: CFString) -> T? {
    guard let raw = getAttribute(element, attr) else { return nil }
    return raw as? T
}

// Define missing constant if needed
let kAXFrameAttribute = "AXFrame" as CFString

// Recursive function to dump element
func dumpElement(_ element: AXUIElement, depth: Int = 0) -> [String: Any]? {
    if depth > 5 { 
        return ["truncated": true] 
    }

    var info: [String: Any] = [:]
    
    if let role: String = attribute(element, kAXRoleAttribute as CFString) {
        info["role"] = role
    }
    if let subrole: String = attribute(element, kAXSubroleAttribute as CFString) {
        info["subrole"] = subrole
    }
    if let title: String = attribute(element, kAXTitleAttribute as CFString), !title.isEmpty {
        info["title"] = title
    }
    if let val: String = attribute(element, kAXValueAttribute as CFString), !val.isEmpty {
        info["value"] = val
    }
    if let desc: String = attribute(element, kAXDescriptionAttribute as CFString), !desc.isEmpty {
        info["description"] = desc
    }
    if let identifier: String = attribute(element, kAXIdentifierAttribute as CFString), !identifier.isEmpty {
        info["identifier"] = identifier
    }
    if let frame: [String: CGFloat] = attribute(element, kAXFrameAttribute) {
        info["frame"] = frame
    }
    
    // Get children
    var childrenRef: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenRef)
    if result == .success, let children = childrenRef as? [AXUIElement] {
        let childInfos = children.compactMap { dumpElement($0, depth: depth + 1) }
        if !childInfos.isEmpty {
            info["children"] = childInfos
        }
    }
    
    return info
}

// Check permissions
let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(options) {
    fputs("{\"error\":\"AX not trusted\"}\n", stderr)
    exit(1)
}

// Main execution
let systemWide = AXUIElementCreateSystemWide()
var focusedAppRef: AnyObject?
let result = AXUIElementCopyAttributeValue(systemWide, kAXFocusedApplicationAttribute as CFString, &focusedAppRef)

if result == .success {
    let focusedApp = focusedAppRef as! AXUIElement
    let dump = dumpElement(focusedApp)
    
    if let data = try? JSONSerialization.data(withJSONObject: dump ?? [:], options: .prettyPrinted),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
} else {
    print("{\"error\": \"Could not get focused application.\"}")
}
