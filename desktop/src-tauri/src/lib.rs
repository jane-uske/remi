#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

#[tauri::command]
fn toggle_chat_panel(app: tauri::AppHandle) {
    let Some(chat_win) = app.get_webview_window("chat") else {
        return;
    };
    let Some(char_win) = app.get_webview_window("character") else {
        return;
    };

    if chat_win.is_visible().unwrap_or(false) {
        let _ = chat_win.hide();
    } else {
        if let (Ok(char_pos), Ok(char_size)) =
            (char_win.outer_position(), char_win.outer_size())
        {
            let _ = chat_win.set_position(tauri::PhysicalPosition::new(
                char_pos.x + char_size.width as i32 + 8,
                char_pos.y,
            ));
        }
        let _ = chat_win.show();
        let _ = chat_win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let quit =
                MenuItem::with_id(app, "quit", "Quit Remi", true, None::<&str>)?;
            let show =
                MenuItem::with_id(app, "show", "Show Remi", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Remi AI Companion")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("character") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("character") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![toggle_chat_panel])
        .run(tauri::generate_context!())
        .expect("error while running Remi desktop");
}
