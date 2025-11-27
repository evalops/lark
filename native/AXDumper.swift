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
func getAttribute(_ element: AXUIElement, _ attribute: String) -> Any? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    if result == .success, let v = value {
        return unwrapAXValue(v)
    }
    return nil
}

// Recursive function to dump element
func dumpElement(_ element: AXUIElement, depth: Int = 0) -> [String: Any]? {
    if depth > 5 { return nil } // Safety limit

    var info: [String: Any] = [:]
    
    if let role = getAttribute(element, kAXRoleAttribute) as? String {
        info["role"] = role
    }
    if let title = getAttribute(element, kAXTitleAttribute) as? String, !title.isEmpty {
        info["title"] = title
    }
    if let frame = getAttribute(element, "AXFrame") as? [String: CGFloat] {
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
    print("{\"error\": \"Could not get focused application. Check permissions.\"}")
}

