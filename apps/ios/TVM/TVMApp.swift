import SwiftUI

// DEVICE GATE: See docs/IOS_TESTING.md. This app is a standalone player.
// It does not need a PC, LAN token, or Core on another computer.
@main
struct TVMApp: App {
    var body: some Scene {
        WindowGroup { StandaloneRoot().preferredColorScheme(.dark) }
    }
}

struct BrowseSession: Identifiable {
    let id = UUID()
    let origin: URL
    let cookie: HTTPCookie?
    let isStandalone: Bool

    func isSameOrigin(_ url: URL) -> Bool {
        guard let a = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let b = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        func port(_ value: URLComponents) -> Int { value.port ?? (value.scheme?.lowercased() == "https" ? 443 : 80) }
        return a.scheme?.lowercased() == b.scheme?.lowercased() &&
            a.host?.lowercased() == b.host?.lowercased() && port(a) == port(b) &&
            b.user == nil && b.password == nil
    }
}

@MainActor
final class StandaloneRuntime: ObservableObject {
    @Published var session: BrowseSession?
    @Published var error: String?
    @Published var starting = true
    let core = TVMLocalCore()
    private var server: TVMLocalServer?

    func start() async {
        guard session == nil || starting else { return }
        // Local only, and instant: an interface staged on the last run goes live
        // now, and one left over from a different app build is dropped. The
        // launch used to wait here on a GitHub download of up to 90 seconds.
        TVMBundledUI.prepare(store: core.store)
        do {
            let server = TVMLocalServer(core: core)
            try server.start()
            self.server = server
            session = BrowseSession(origin: server.origin, cookie: nil, isStandalone: true)
            error = nil
        } catch {
            self.error = "TVM could not start its on-device core."
        }
        starting = false
        // Look for the next interface while the viewer carries on. It is staged
        // for the next open and never swapped under them.
        let store = core.store
        Task.detached(priority: .utility) {
            await TVMUpdater.applyIfNeeded(store: store, session: TVMUpdater.downloadSession())
        }
    }

    func useLocal() {
        guard let server else { return }
        session = BrowseSession(origin: server.origin, cookie: nil, isStandalone: true)
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published var address = ""
    @Published var token = ""
    @Published var allowLocalHTTP = false
    @Published var busy = false
    @Published var error: String?
    @Published var active: ActiveConnection?

    func connect() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let connection = try Connection.validated(address: address, token: token, allowLocalHTTP: allowLocalHTTP)
            let cookie = try await SessionClient.connect(connection)
            do { try CredentialStore.save(connection) }
            catch {
                await SessionClient.disconnect(connection, cookie: cookie)
                throw error
            }
            active = ActiveConnection(connection: connection, cookie: cookie)
        } catch let problem as ClientError { self.error = problem.localizedDescription }
        catch {
            self.error = "Could not reach the optional home Core. This phone app still works without a PC."
        }
    }

    func disconnect() {
        do { try CredentialStore.clear() }
        catch { self.error = error.localizedDescription; return }
        let previous = active
        active = nil
        token = ""
        error = nil
        if let previous {
            Task { await SessionClient.disconnect(previous.connection, cookie: previous.cookie) }
        }
    }
}

struct ActiveConnection: Identifiable {
    let id = UUID()
    let connection: Connection
    let cookie: HTTPCookie
}

struct StandaloneRoot: View {
    @StateObject private var runtime = StandaloneRuntime()

    var body: some View {
        Group {
            if let session = runtime.session {
                PlayerShell(session: session, onUseLocal: runtime.useLocal)
            } else if let error = runtime.error {
                VStack(spacing: 16) {
                    Text("TVM").font(.largeTitle.bold())
                    Text(error).multilineTextAlignment(.center).foregroundStyle(.secondary)
                }
                .padding(28)
            } else {
                ZStack {
                    Color.black.ignoresSafeArea()
                    ProgressView().tint(.white)
                }
            }
        }
        .task { await runtime.start() }
    }
}

enum TVMViewport {
    /// 16:9 letterbox for video. Never use this for the live browser chrome —
    /// a keyboard-shrunk `available` height collapses the whole app into a strip.
    static func fittedSize(in available: CGSize) -> CGSize {
        let width = max(0, min(available.width, available.height * 16 / 9))
        return CGSize(width: width, height: width * 9 / 16)
    }

    /// The in-app browser fills the window. Keyboard occlusion is a CSS inset, not a frame change.
    static func webViewSize(in window: CGSize) -> CGSize {
        CGSize(width: max(0, window.width), height: max(0, window.height))
    }
}

struct PlayerShell: View {
    let session: BrowseSession
    var onUseLocal: () -> Void
    @StateObject private var lan = AppModel()
    @State private var reload = UUID()
    @State private var error: String?
    @State private var loading = true
    @State private var showHomeCore = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let error {
                VStack(spacing: 18) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle)
                    Text(error).multilineTextAlignment(.center)
                    Button("Reload", action: reloadPage).buttonStyle(.borderedProminent)
                }
                .padding(28)
            } else {
                TVMWebView(session: currentSession, loading: $loading, error: $error)
                    .id(reload)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea(.container)
                    .ignoresSafeArea(.keyboard)
            }
        }
        .ignoresSafeArea(.keyboard)
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 10) {
                if loading { ProgressView().controlSize(.small).tint(.white) }
                Menu {
                    Button("Reload TVM", action: reloadPage)
                    if session.isStandalone {
                        Button("Use a home Core (optional)") { showHomeCore = true }
                    } else {
                        Button("Back to this iPhone") {
                            lan.disconnect()
                            onUseLocal()
                            reloadPage()
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle.fill")
                        .font(.title2)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.white, .black.opacity(0.45))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("App settings")
            }
            .padding(.trailing, 8)
        }
        .sheet(isPresented: $showHomeCore) {
            OptionalHomeCoreSheet(model: lan) {
                showHomeCore = false
                reloadPage()
            }
        }
    }

    private var currentSession: BrowseSession {
        if let active = lan.active {
            return BrowseSession(origin: active.connection.origin, cookie: active.cookie, isStandalone: false)
        }
        return session
    }

    private func reloadPage() {
        error = nil
        loading = true
        reload = UUID()
    }
}

struct OptionalHomeCoreSheet: View {
    @ObservedObject var model: AppModel
    let onClose: () -> Void
    @FocusState private var field: Field?
    private enum Field { case address, token }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Optional. TVM on this iPhone already runs by itself. Use this only if you want the computer Core on your Wi-Fi.")
                        .foregroundStyle(.secondary)
                    labeled("Host address") {
                        TextField("http://192.168.1.20:7345", text: $model.address)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($field, equals: .address)
                    }
                    labeled("LAN token") {
                        SecureField("Paste the host LAN token", text: $model.token)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($field, equals: .token)
                            .privacySensitive()
                    }
                    Toggle("Allow private LAN HTTP", isOn: $model.allowLocalHTTP)
                    if let error = model.error {
                        Text(error).foregroundStyle(.orange)
                    }
                    Button {
                        Task {
                            await model.connect()
                            if model.active != nil { onClose() }
                        }
                    } label: {
                        Text(model.busy ? "Connecting…" : "Connect to home Core")
                            .frame(maxWidth: .infinity, minHeight: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.busy)
                }
                .padding(20)
            }
            .navigationTitle("Home Core")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close", action: onClose) }
            }
        }
    }

    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold))
            content()
                .padding(12)
                .frame(minHeight: 44)
                .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}
