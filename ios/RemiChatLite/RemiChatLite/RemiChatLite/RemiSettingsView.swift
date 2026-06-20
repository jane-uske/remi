import Combine
import SwiftUI

// MARK: - Settings Data Models

struct RemiServiceHealth: Equatable {
    let url: String
    let enabled: Bool
    let up: Bool
    let latencyMs: Int?
    let error: String?
}

struct RemiHealthResponse: Equatable {
    let comfyui: RemiServiceHealth?
    let mlx: RemiServiceHealth?
}

// MARK: - Settings View Model

@MainActor
final class RemiSettingsViewModel: ObservableObject {
    enum Status: Equatable {
        case idle, loading, saving, saved, error(String)
    }

    @Published var form: [String: String] = [:]
    @Published var health: RemiHealthResponse?
    @Published var status: Status = .idle

    private var healthPollTask: Task<Void, Never>?

    /// Base URL derived from the WebSocket URL (same host, http(s) scheme).
    private var baseURL: String {
        let wsURL = RemiChatConfig.wsURLString
        return wsURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .components(separatedBy: "/ws").first ?? wsURL
    }

    func load() async {
        status = .loading
        do {
            let url = URL(string: "\(baseURL)/api/settings")!
            let (data, _) = try await URLSession.shared.data(from: url)
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let settings = json["settings"] as? [String: Any] {
                var stringForm: [String: String] = [:]
                for (key, value) in settings {
                    stringForm[key] = "\(value)"
                }
                form = stringForm
            }
            status = .idle
        } catch {
            status = .error("加载失败: \(error.localizedDescription)")
        }
    }

    func save() async {
        status = .saving
        do {
            var request = URLRequest(url: URL(string: "\(baseURL)/api/settings")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: form)
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                status = .saved
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                if status == .saved { status = .idle }
            } else {
                status = .error("保存失败")
            }
        } catch {
            status = .error("保存失败: \(error.localizedDescription)")
        }
    }

    func startHealthPolling() {
        healthPollTask?.cancel()
        healthPollTask = Task {
            while !Task.isCancelled {
                await probeHealth()
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    func stopHealthPolling() {
        healthPollTask?.cancel()
        healthPollTask = nil
    }

    private func probeHealth() async {
        guard let url = URL(string: "\(baseURL)/api/health/services") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            health = RemiHealthResponse(
                comfyui: parseServiceHealth(json["comfyui"]),
                mlx: parseServiceHealth(json["mlx"])
            )
        } catch {
            // Silently ignore health probe failures.
        }
    }

    private func parseServiceHealth(_ value: Any?) -> RemiServiceHealth? {
        guard let dict = value as? [String: Any] else { return nil }
        return RemiServiceHealth(
            url: dict["url"] as? String ?? "",
            enabled: dict["enabled"] as? Bool ?? false,
            up: dict["up"] as? Bool ?? false,
            latencyMs: dict["latencyMs"] as? Int,
            error: dict["error"] as? String
        )
    }
}

// MARK: - Settings View

struct RemiSettingsView: View {
    @StateObject private var vm = RemiSettingsViewModel()
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    healthPills
                    imageGenSection
                    voiceSection
                    nsfwSection
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(backgroundGradient.ignoresSafeArea())
            .navigationTitle("服务设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    saveButton
                }
            }
        }
        .task {
            await vm.load()
            vm.startHealthPolling()
        }
        .onDisappear { vm.stopHealthPolling() }
    }

    // MARK: - Health Pills

    private var healthPills: some View {
        HStack(spacing: 12) {
            if let comfyui = vm.health?.comfyui {
                healthPill(name: "ComfyUI", service: comfyui)
            }
            if let mlx = vm.health?.mlx {
                healthPill(name: "MLX TTS", service: mlx)
            }
            Spacer()
        }
    }

    private func healthPill(name: String, service: RemiServiceHealth) -> some View {
        HStack(spacing: 6) {
            Circle()
                .fill(service.up ? Color.green : (service.enabled ? Color.red : Color.gray))
                .frame(width: 8, height: 8)
            Text(name)
                .font(.system(size: 12, weight: .medium, design: .rounded))
            if let latency = service.latencyMs, service.up {
                Text("\(latency)ms")
                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                    .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
            }
        }
        .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
    }

    // MARK: - Image Generation Section

    private var imageGenSection: some View {
        SettingsSection(title: "🎨 生图 (ComfyUI)", colorScheme: colorScheme) {
            SettingsToggle(label: "启用", key: "REMI_COMFYUI_ENABLED", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "Base URL", key: "REMI_COMFYUI_BASE_URL", placeholder: "http://127.0.0.1:8188", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "Checkpoint", key: "REMI_COMFYUI_CHECKPOINT", placeholder: "model.safetensors", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "宽度", key: "REMI_COMFYUI_WIDTH", placeholder: "512", form: $vm.form, colorScheme: colorScheme)
                .keyboardType(.numberPad)
            SettingsTextField(label: "高度", key: "REMI_COMFYUI_HEIGHT", placeholder: "768", form: $vm.form, colorScheme: colorScheme)
                .keyboardType(.numberPad)
        }
    }

    // MARK: - Voice Section

    private var voiceSection: some View {
        SettingsSection(title: "🗣️ 语音 (TTS)", colorScheme: colorScheme) {
            SettingsPicker(label: "Provider", key: "REMI_TTS_PROVIDER", options: ["edge", "piper", "openai", "volc", "mlx"], form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "MLX URL", key: "REMI_TTS_MLX_URL", placeholder: "http://127.0.0.1:8000", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "MLX Model", key: "REMI_TTS_MLX_MODEL", placeholder: "Qwen/Qwen3-TTS", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "MLX Speaker", key: "REMI_TTS_MLX_SPEAKER", placeholder: "Chelsie", form: $vm.form, colorScheme: colorScheme)
        }
    }

    // MARK: - NSFW Section

    private var nsfwSection: some View {
        SettingsSection(title: "🔞 成人模式 (NSFW)", colorScheme: colorScheme) {
            SettingsToggle(label: "启用成人模式", key: "REMI_NSFW_ENABLED", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "NSFW Checkpoint", key: "REMI_COMFYUI_NSFW_CHECKPOINT", placeholder: "nsfw_model.safetensors", form: $vm.form, colorScheme: colorScheme)
            SettingsTextField(label: "NSFW 负面提示", key: "REMI_COMFYUI_NSFW_NEGATIVE", placeholder: "ugly, deformed...", form: $vm.form, colorScheme: colorScheme)
        }
    }

    // MARK: - Save Button

    private var saveButton: some View {
        Button(action: { Task { await vm.save() } }) {
            switch vm.status {
            case .saving:
                ProgressView().controlSize(.small)
            case .saved:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            default:
                Text("保存")
            }
        }
        .disabled(vm.status == .loading || vm.status == .saving)
    }

    private var backgroundGradient: some View {
        LinearGradient(
            colors: RemiDesignTokens.backgroundStops(colorScheme),
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Reusable Setting Components

private struct SettingsSection<Content: View>: View {
    let title: String
    let colorScheme: ColorScheme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))

            VStack(spacing: 10) {
                content
            }
            .padding(16)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}

private struct SettingsTextField: View {
    let label: String
    let key: String
    let placeholder: String
    @Binding var form: [String: String]
    let colorScheme: ColorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(RemiDesignTokens.secondaryText(colorScheme))
            TextField(placeholder, text: Binding(
                get: { form[key] ?? "" },
                set: { form[key] = $0 }
            ))
            .font(.system(size: 14, weight: .regular, design: .monospaced))
            .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(.white.opacity(colorScheme == .dark ? 0.06 : 0.30), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
        }
    }
}

private struct SettingsToggle: View {
    let label: String
    let key: String
    @Binding var form: [String: String]
    let colorScheme: ColorScheme

    private var isOn: Binding<Bool> {
        Binding(
            get: { form[key]?.lowercased() == "true" || form[key] == "1" },
            set: { form[key] = $0 ? "true" : "false" }
        )
    }

    var body: some View {
        Toggle(isOn: isOn) {
            Text(label)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
        }
        .tint(RemiDesignTokens.accent(colorScheme))
    }
}

private struct SettingsPicker: View {
    let label: String
    let key: String
    let options: [String]
    @Binding var form: [String: String]
    let colorScheme: ColorScheme

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .foregroundStyle(RemiDesignTokens.primaryText(colorScheme))
            Spacer()
            Picker(label, selection: Binding(
                get: { form[key] ?? options.first ?? "" },
                set: { form[key] = $0 }
            )) {
                ForEach(options, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
            .pickerStyle(.menu)
            .tint(RemiDesignTokens.accent(colorScheme))
        }
    }
}
