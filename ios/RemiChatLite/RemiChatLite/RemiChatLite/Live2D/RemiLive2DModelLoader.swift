import Foundation

struct Live2DModelConfig: Decodable {
    let Version: Int
    let FileReferences: FileReferences
    let Groups: [ParameterGroup]?

    struct FileReferences: Decodable {
        let Moc: String
        let Textures: [String]
        let Physics: String?
        let Pose: String?
        let DisplayInfo: String?
        let Motions: [String: [MotionEntry]]?
    }

    struct MotionEntry: Decodable {
        let File: String
    }

    struct ParameterGroup: Decodable {
        let Target: String
        let Name: String
        let Ids: [String]
    }
}

@MainActor
final class RemiLive2DModelLoader {

    struct LoadedModel {
        let basePath: String
        let config: Live2DModelConfig
        let mocData: Data
        let textureURLs: [URL]
        let physicsData: Data?
        let idleMotionPaths: [String]
    }

    static func load(modelDirectory: String = "Resources/live2d/hiyori-pro") -> LoadedModel? {
        guard let basePath = Bundle.main.resourcePath.map({ $0 + "/" + modelDirectory }) else {
            print("[Live2D] Bundle resource path not found")
            return nil
        }

        let modelJsonPath = basePath + "/hiyori_pro_t11.model3.json"
        guard let jsonData = FileManager.default.contents(atPath: modelJsonPath) else {
            print("[Live2D] model3.json not found at \(modelJsonPath)")
            return nil
        }

        let config: Live2DModelConfig
        do {
            config = try JSONDecoder().decode(Live2DModelConfig.self, from: jsonData)
        } catch {
            print("[Live2D] Failed to parse model3.json: \(error)")
            return nil
        }

        let mocPath = basePath + "/" + config.FileReferences.Moc
        guard let mocData = FileManager.default.contents(atPath: mocPath) else {
            print("[Live2D] .moc3 file not found at \(mocPath)")
            return nil
        }

        let textureURLs = config.FileReferences.Textures.map { texPath in
            URL(fileURLWithPath: basePath + "/" + texPath)
        }

        var physicsData: Data?
        if let physicsFile = config.FileReferences.Physics {
            physicsData = FileManager.default.contents(atPath: basePath + "/" + physicsFile)
        }

        let idleMotionPaths = config.FileReferences.Motions?["Idle"]?.map { entry in
            basePath + "/" + entry.File
        } ?? []

        print("[Live2D] Model loaded: moc3=\(mocData.count) bytes, textures=\(textureURLs.count), idle motions=\(idleMotionPaths.count)")

        return LoadedModel(
            basePath: basePath,
            config: config,
            mocData: mocData,
            textureURLs: textureURLs,
            physicsData: physicsData,
            idleMotionPaths: idleMotionPaths
        )
    }
}
