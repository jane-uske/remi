#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Gap (px) between the character window and the chat panel.
const CHAT_GAP: i32 = 8;

/// Place the chat panel beside the character window, preferring the right side
/// but flipping to the left when it would overflow the screen, and clamping the
/// final position so the panel never lands off-screen.
fn position_chat_near_character(
    chat_win: &tauri::WebviewWindow,
    char_win: &tauri::WebviewWindow,
) {
    let (Ok(char_pos), Ok(char_size), Ok(chat_size)) = (
        char_win.outer_position(),
        char_win.outer_size(),
        chat_win.outer_size(),
    ) else {
        return;
    };

    let chat_w = chat_size.width as i32;
    let chat_h = chat_size.height as i32;

    let mut x = char_pos.x + char_size.width as i32 + CHAT_GAP;
    let mut y = char_pos.y;

    if let Ok(Some(monitor)) = char_win.current_monitor() {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let mon_left = mon_pos.x;
        let mon_top = mon_pos.y;
        let mon_right = mon_pos.x + mon_size.width as i32;
        let mon_bottom = mon_pos.y + mon_size.height as i32;

        // Not enough room on the right → try the left side of the character.
        if x + chat_w > mon_right {
            let left_x = char_pos.x - chat_w - CHAT_GAP;
            x = if left_x >= mon_left {
                left_x
            } else {
                mon_right - chat_w
            };
        }

        // Keep the whole panel inside the monitor.
        x = x.clamp(mon_left, (mon_right - chat_w).max(mon_left));
        y = y.clamp(mon_top, (mon_bottom - chat_h).max(mon_top));
    }

    let _ = chat_win.set_position(tauri::PhysicalPosition::new(x, y));
}

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
        position_chat_near_character(&chat_win, &char_win);
        let _ = chat_win.show();
        let _ = chat_win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| match event {
            // The chat window's close button should hide it, not destroy it,
            // so toggle_chat_panel can show it again later.
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "chat" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Keep the chat panel glued to the character while it's dragged.
            tauri::WindowEvent::Moved(_) => {
                if window.label() != "character" {
                    return;
                }
                let app = window.app_handle();
                let (Some(chat_win), Some(char_win)) = (
                    app.get_webview_window("chat"),
                    app.get_webview_window("character"),
                ) else {
                    return;
                };
                if chat_win.is_visible().unwrap_or(false) {
                    position_chat_near_character(&chat_win, &char_win);
                }
            }
            _ => {}
        })
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
