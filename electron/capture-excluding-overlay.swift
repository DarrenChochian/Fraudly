import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

enum CaptureError: LocalizedError {
  case invalidArgs
  case displayNotFound
  case overlayWindowNotFound
  case unsupportedMacOS
  case imageEncodingFailed

  var errorDescription: String? {
    switch self {
    case .invalidArgs:
      return "Expected arguments: <display-id> <overlay-window-id> <output-path>"
    case .displayNotFound:
      return "Display not found"
    case .overlayWindowNotFound:
      return "Overlay window not found"
    case .unsupportedMacOS:
      return "This screenshot path requires macOS 14 or newer"
    case .imageEncodingFailed:
      return "Failed to encode PNG"
    }
  }
}

@available(macOS 14.0, *)
func captureUsingScreenCaptureKit(displayID: CGDirectDisplayID, overlayWindowID: CGWindowID, outputPath: String) async throws {
  let content = try await SCShareableContent.current

  guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
    throw CaptureError.displayNotFound
  }

  guard let overlayWindow = content.windows.first(where: { $0.windowID == overlayWindowID }) else {
    throw CaptureError.overlayWindowNotFound
  }

  let filter = SCContentFilter(display: display, excludingWindows: [overlayWindow])
  let configuration = SCStreamConfiguration()
  configuration.width = display.width
  configuration.height = display.height

  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
  try writeImage(image, to: outputPath)
}

func writeImage(_ image: CGImage, to outputPath: String) throws {
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw CaptureError.imageEncodingFailed
  }
  try data.write(to: URL(fileURLWithPath: outputPath), options: .atomic)
}

@main
struct OverlayExcludingCapture {
  static func main() async {
    do {
      guard CommandLine.arguments.count == 4 else {
        throw CaptureError.invalidArgs
      }

      guard
        let displayID = UInt32(CommandLine.arguments[1]),
        let overlayWindowID = UInt32(CommandLine.arguments[2])
      else {
        throw CaptureError.invalidArgs
      }

      let outputPath = CommandLine.arguments[3]
      let outputURL = URL(fileURLWithPath: outputPath)
      try FileManager.default.createDirectory(
        at: outputURL.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: nil
      )

      guard #available(macOS 14.0, *) else {
        throw CaptureError.unsupportedMacOS
      }

      try await captureUsingScreenCaptureKit(
        displayID: displayID,
        overlayWindowID: overlayWindowID,
        outputPath: outputPath
      )

      FileHandle.standardOutput.write(Data(outputPath.utf8))
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
      FileHandle.standardError.write(Data(message.utf8))
      exit(1)
    }
  }
}
