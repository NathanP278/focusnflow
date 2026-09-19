import sys
import time
from playwright.sync_api import sync_playwright

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: console_errors.append(str(err)))

        print("Navigating to http://localhost:3000...")
        page.goto("http://localhost:3000", wait_until="domcontentloaded")
        page.wait_for_selector("#timeDigits")
        time.sleep(1)

        # 1. Check title, time digits, and verify Undo toast is hidden on load (Fix 1)
        title = page.title()
        digits = page.locator("#timeDigits").text_content()
        print(f"Page title: {title}")
        print(f"Initial digits: {digits}")
        assert ":" in digits, f"Expected mm:ss format, got {digits}"
        undo_toast = page.locator("#undoToast")
        assert undo_toast.is_hidden(), "Undo toast must be hidden on clean page load"

        # 2. Check Canvas particle initialization
        canvas_box = page.locator("#bg-canvas").bounding_box()
        assert canvas_box is not None and canvas_box["width"] > 0, "Canvas not rendered"
        print(f"Canvas size: {canvas_box['width']}x{canvas_box['height']}")

        # 3. Test Timer Start / Pause
        toggle_btn = page.locator("#toggleBtn")
        assert page.locator("#toggleBtnText").text_content() == "Start"
        toggle_btn.click()
        time.sleep(0.3)
        assert page.locator("#toggleBtnText").text_content() == "Pause"

        # Pause again
        toggle_btn.click()
        time.sleep(0.2)
        assert page.locator("#toggleBtnText").text_content() == "Start"

        # 4. Test Quick Adjust (+1m)
        curr_min = int(page.locator("#timeDigits").text_content().split(":")[0])
        plus_one = page.locator("button[data-adjust='60000']")
        plus_one.click()
        time.sleep(0.2)
        new_min = int(page.locator("#timeDigits").text_content().split(":")[0])
        print(f"Digits adjustment: {curr_min} -> {new_min}")
        assert new_min == curr_min + 1

        # 5. Test Mode Switching
        short_break_btn = page.locator("button[data-mode='shortBreak']")
        short_break_btn.click()
        time.sleep(0.2)
        sb_digits = page.locator("#timeDigits").text_content()
        print(f"Short break digits: {sb_digits}")
        assert "05:00" in sb_digits

        # Back to focus mode
        focus_btn = page.locator("button[data-mode='work']")
        focus_btn.click()
        time.sleep(0.2)

        # 6. Test Pomodoro 4-Interval Cycle progression
        cycle_dots = page.locator(".cycle-dot")
        assert cycle_dots.count() == 4, f"Expected 4 cycle dots, found {cycle_dots.count()}"
        first_dot = cycle_dots.nth(0)
        assert "active" in first_dot.get_attribute("class")

        # 7. Test Zen Mode Toggle
        zen_btn = page.locator("#zenToggleBtn")
        zen_btn.click()
        time.sleep(0.2)
        assert "zen-mode" in page.locator("#appContainer").get_attribute("class")
        # Toggle back
        zen_btn.click()
        time.sleep(0.2)
        assert "zen-mode" not in (page.locator("#appContainer").get_attribute("class") or "")

        # 8. Test Theme Toggle (Dark / Light)
        theme_btn = page.locator("#themeToggleBtn")
        theme_btn.click()
        time.sleep(0.2)
        theme_attr = page.locator("html").get_attribute("data-theme")
        print(f"Theme attribute after click: {theme_attr}")
        assert theme_attr in ["dark", "light"]

        # 9. Test Ambient Soundscape selector
        rain_chip = page.locator("button[data-sound='rain']")
        rain_chip.click()
        time.sleep(0.2)
        assert "active" in rain_chip.get_attribute("class")
        off_chip = page.locator("button[data-sound='none']")
        off_chip.click()
        time.sleep(0.2)
        assert "active" in off_chip.get_attribute("class")

        # 10. Test Task Creation & Optimistic Sync
        task_input = page.locator("#taskInput")
        task_input.fill("E2E Test Task 1")
        page.locator(".task-add-btn").click()
        time.sleep(0.5)

        task_item = page.locator(".task-item").first
        task_text = task_item.locator(".task-title").text_content()
        print(f"Created task item: {task_text}")
        assert "E2E Test Task 1" in task_text

        # Verify task is selected for active focus
        time.sleep(0.2)
        active_focus = page.locator("#activeFocusContainer").text_content()
        print(f"Active focus container: {active_focus}")
        assert "E2E Test Task 1" in active_focus

        # 11. Test Task Inline Edit via double click
        task_title = task_item.locator(".task-title")
        task_title.dblclick()
        time.sleep(0.2)
        edit_input = task_item.locator(".task-edit-input")
        assert edit_input.is_visible()
        edit_input.fill("Renamed Test Task")
        edit_input.press("Enter")
        time.sleep(0.3)
        assert "Renamed Test Task" in task_item.locator(".task-title").text_content()

        # 12. Test Task Filters (All, Active, Completed)
        checkbox = task_item.locator(".task-checkbox-wrap")
        checkbox.click()
        time.sleep(0.3)
        assert "completed" in task_item.get_attribute("class")

        # Filter active
        page.locator("button[data-filter='active']").click()
        time.sleep(0.2)
        for item in page.locator(".task-item").all():
            assert "completed" not in (item.get_attribute("class") or "")

        # Filter completed
        page.locator("button[data-filter='completed']").click()
        time.sleep(0.2)
        assert page.locator(".task-item").count() >= 1
        for item in page.locator(".task-item").all():
            assert "completed" in (item.get_attribute("class") or "")

        # Reset to all
        page.locator("button[data-filter='all']").click()
        time.sleep(0.2)

        # Clear completed tasks and verify clean task list (Fix 2)
        page.locator("#clearCompletedBtn").click()
        time.sleep(0.3)
        assert page.locator(".task-item").count() == 0, "Tasks list should be empty after clearing completed"

        # 13. Test Keyboard Shortcuts (Space, R, S, Z)
        page.keyboard.press("Space")
        time.sleep(0.3)
        assert page.locator("#toggleBtnText").text_content() == "Pause"
        page.keyboard.press("Space")
        time.sleep(0.2)
        assert page.locator("#toggleBtnText").text_content() == "Start"

        # 14. Test Daily Stats Detail Modal
        stats_badge = page.locator("#dailyStatsBadge")
        stats_badge.click()
        time.sleep(0.3)
        stats_modal = page.locator("#statsDialog")
        assert stats_modal.is_visible()
        page.locator("#okStatsBtn").click()
        time.sleep(0.2)
        assert not stats_modal.is_visible()

        # 15. Test Desktop Equal-Height Column Alignment & Self-Compensation
        page.set_viewport_size({"width": 1280, "height": 850})
        time.sleep(0.3)
        focus_box = page.locator(".focus-panel").bounding_box()
        prod_box = page.locator(".productivity-panel").bounding_box()
        print(f"Columns bounding boxes -> Focus: {focus_box['height']}px, Productivity: {prod_box['height']}px")
        assert abs(focus_box["height"] - prod_box["height"]) <= 2.5, "Columns should stretch to equal height on desktop"

        # 16. Test Luminous Progress Ring Orbit Dot
        orbit_dot = page.locator("#progressOrbitDot")
        assert orbit_dot.is_visible()
        cx = float(orbit_dot.get_attribute("cx") or "0")
        cy = float(orbit_dot.get_attribute("cy") or "0")
        assert cx > 0 and cy > 0, "Orbit dot must have valid coordinates"

        # 17. Test Shortcuts HUD Dialog Centering & Geometry (Fix 3)
        shortcuts_btn = page.locator("#shortcutsBtn")
        shortcuts_btn.click()
        time.sleep(0.2)
        shortcuts_dialog = page.locator("#shortcutsDialog")
        assert shortcuts_dialog.is_visible(), "Shortcuts dialog should be open"

        dialog_overflow = page.evaluate("() => window.getComputedStyle(document.getElementById('shortcutsDialog')).overflow")
        card_radius = page.evaluate("() => window.getComputedStyle(document.querySelector('.shortcuts-modal-card')).borderRadius")
        card_overflow = page.evaluate("() => window.getComputedStyle(document.querySelector('.shortcuts-modal-card')).overflow")
        print(f"Shortcuts dialog overflow: {dialog_overflow}, card radius: {card_radius}, card overflow: {card_overflow}")
        assert dialog_overflow == "visible", "Dialog overflow must be visible"
        assert card_overflow == "hidden", "Card overflow must be hidden"
        assert card_radius != "0px", "Card must have rounded corners"

        # Assert dead-center alignment horizontally in viewport
        card_box = page.locator(".shortcuts-modal-card").bounding_box()
        vp_width = page.viewport_size["width"]
        card_center_x = card_box["x"] + card_box["width"] / 2
        vp_center_x = vp_width / 2
        print(f"Centering check -> Card Center: {card_center_x}px, Viewport Center: {vp_center_x}px")
        assert abs(card_center_x - vp_center_x) <= 3.0, "Shortcuts modal must be centered horizontally"

        page.locator("#closeShortcutsBtn").click()
        time.sleep(0.2)
        assert not shortcuts_dialog.is_visible()

        # 18. Test Picture-in-Picture Engine & Canvas Rendering (Fix 4)
        pip_btn = page.locator("#pipToggleBtn")
        assert pip_btn.is_visible(), "PiP toggle button must be visible in header"
        canvas = page.locator("#pipCanvas")
        assert canvas.count() == 1
        assert canvas.get_attribute("width") == "512"
        assert canvas.get_attribute("height") == "512"
        video = page.locator("#pipVideo")
        assert video.count() == 1

        # Assert canvas contains rendered pixels and theme adaptation
        has_drawing = page.evaluate("""() => {
            const c = document.getElementById('pipCanvas');
            const ctx = c.getContext('2d');
            const imgData = ctx.getImageData(0, 0, c.width, c.height).data;
            return imgData.some(byte => byte !== 0);
        }""")
        assert has_drawing, "Canvas must contain rendered pixels"

        # Check dark vs light pixel reading
        def get_pip_pixel(x=4, y=4):
            return page.evaluate(f"""() => {{
                const c = document.getElementById('pipCanvas');
                const ctx = c.getContext('2d');
                const p = ctx.getImageData({x}, {y}, 1, 1).data;
                return [p[0], p[1], p[2], p[3]];
            }}""")

        # Currently in dark theme: background is #0E1116
        dark_pixel = get_pip_pixel(4, 4)
        print(f"PiP dark mode pixel at (4,4): {dark_pixel}")
        assert dark_pixel[0] < 40 and dark_pixel[1] < 40 and dark_pixel[2] < 40, f"Expected dark bg, got {dark_pixel}"

        # Toggle to light theme
        page.locator("#themeToggleBtn").click()
        time.sleep(0.2)
        if page.locator("html").get_attribute("data-theme") == "light":
            light_pixel = get_pip_pixel(4, 4)
            print(f"PiP light mode pixel at (4,4): {light_pixel}")
            assert light_pixel[0] > 220 and light_pixel[1] > 220 and light_pixel[2] > 220, f"Expected light bg, got {light_pixel}"
            # Toggle back to dark
            page.locator("#themeToggleBtn").click()
            time.sleep(0.2)

        # 19. Test Settings Modal with Color Palette & Audio Options
        settings_btn = page.locator("#settingsBtn")
        settings_btn.click()
        time.sleep(0.2)
        dialog = page.locator("#settingsDialog")
        assert dialog.is_visible(), "Settings dialog not visible"

        # Palette switch to Mint and check button theming (Fix 1)
        mint_swatch = page.locator("button[data-palette='mint']")
        mint_swatch.click()
        time.sleep(0.2)
        assert page.locator("html").get_attribute("data-color") == "mint"

        # Verify buttons and pill inherit active mint accent in computed styles
        main_btn_bg = page.evaluate("() => window.getComputedStyle(document.getElementById('toggleBtn')).backgroundImage")
        print(f"Main button background with mint palette: {main_btn_bg}")
        assert "gradient" in main_btn_bg

        # Check options existence
        assert page.locator("#chimePresetSelect").is_visible()
        assert page.locator("#tickingSoundSelect").is_visible()
        assert page.locator("#autoStartBreaksToggle").is_visible()
        assert page.locator("#dailyGoalInput").is_visible()

        page.locator("#closeSettingsBtn").click()
        time.sleep(0.2)

        # 20. Test Full State Persistence on Page Reload (Fix 2)
        # Select ambient sound 'rain', volume 65%, toggle mute
        page.locator("button[data-sound='rain']").click()
        time.sleep(0.2)
        page.evaluate("() => { const s = document.getElementById('ambientVolSlider'); s.value = '0.65'; s.dispatchEvent(new Event('input')); }")
        time.sleep(0.2)

        # Reload page
        print("Reloading page to test state persistence...")
        page.reload(wait_until="domcontentloaded")
        time.sleep(0.5)

        # Verify ambient sound hydrated
        assert "active" in page.locator("button[data-sound='rain']").get_attribute("class")
        assert "65%" in page.locator("#ambientVolVal").text_content()

        # Reset ambient sound to none
        page.locator("button[data-sound='none']").click()
        time.sleep(0.2)

        # 21. Verify zero console errors
        print(f"Total console errors captured: {len(console_errors)}")
        if console_errors:
            print("Errors:", console_errors)
        assert len(console_errors) == 0, f"Encountered console errors: {console_errors}"

        # Screenshot for proof
        page.screenshot(path="e2e-screenshot.png", full_page=True)
        print("E2E Screenshot captured: e2e-screenshot.png")

        browser.close()
        print("ALL E2E PLAYWRIGHT TESTS PASSED!")

if __name__ == "__main__":
    run_tests()
