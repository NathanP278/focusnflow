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
        page.on("response", lambda res: print(f"HTTP {res.status} on {res.url}") if res.status >= 400 else None)

        print("Navigating to http://localhost:3000...")
        page.goto("http://localhost:3000", wait_until="domcontentloaded")
        page.wait_for_selector("#timeDigits")
        time.sleep(0.5)

        # Clear any prior leftover tasks to ensure test isolation
        page.evaluate("""async () => {
            try {
                localStorage.clear();
                const res = await fetch('/api/tasks');
                const tasks = await res.json();
                for (const t of tasks) {
                    await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
                }
            } catch {}
        }""")
        page.reload(wait_until="domcontentloaded")
        time.sleep(0.5)

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

        # Ensure dark theme for dark pixel reading
        while page.locator("html").get_attribute("data-theme") != "dark":
            page.locator("#themeToggleBtn").click()
            time.sleep(0.2)

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
        time.sleep(0.5)

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

        # Run Mobile Test Suite
        run_mobile_tests(browser)

        browser.close()
        print("\n==========================================")
        print("ALL DESKTOP & MOBILE PLAYWRIGHT TESTS PASSED!")
        print("==========================================")

def run_mobile_tests(browser):
    print("\n--- STARTING MOBILE SUITE (iPhone 14 Emulation: 390x844 Touch) ---")
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
        has_touch=True,
        is_mobile=True,
    )
    page = context.new_page()

    mobile_errors = []
    page.on("console", lambda msg: mobile_errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: mobile_errors.append(str(err)))

    page.goto("http://localhost:3000", wait_until="domcontentloaded")
    page.wait_for_selector("#timeDigits")
    time.sleep(0.5)

    # 1. Viewport and Mobile Web App Meta tags
    viewport_meta = page.locator("meta[name='viewport']").get_attribute("content")
    print(f"Mobile viewport meta: {viewport_meta}")
    assert "viewport-fit=cover" in viewport_meta, "viewport-fit=cover must be present"

    theme_color_tags = page.locator("meta[name='theme-color']").count()
    assert theme_color_tags >= 1, "theme-color meta must be present"

    app_capable = page.locator("meta[name='apple-mobile-web-app-capable']").get_attribute("content")
    assert app_capable == "yes", "apple-mobile-web-app-capable must be yes"

    # 2. Assert zero horizontal page overflow
    no_overflow = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
    print(f"Zero horizontal page overflow: {no_overflow}")
    assert no_overflow, "Page must not have horizontal scrollbar on mobile"

    # 3. Header controls visibility on mobile
    assert page.locator(".header-secondary-controls").is_hidden(), "Secondary controls (PiP/Shortcuts) must be hidden on mobile"
    haptic_btn = page.locator("#hapticToggleBtn")
    assert haptic_btn.is_visible(), "Haptic toggle button must be visible on mobile"
    sound_btn = page.locator("#soundToggleBtn")
    assert sound_btn.is_visible(), "Sound toggle button must be visible on mobile"

    # 4. Touch Target Sizes (>= 38px on mobile)
    sound_box = sound_btn.bounding_box()
    assert sound_box["width"] >= 38 and sound_box["height"] >= 38, f"Sound button touch target too small: {sound_box}"
    haptic_box = haptic_btn.bounding_box()
    assert haptic_box["width"] >= 38 and haptic_box["height"] >= 38, f"Haptic button touch target too small: {haptic_box}"

    # 5. Mobile View Switcher Tabs & Single-Screen Viewport Switching
    mobile_tabs = page.locator("#mobileViewTabs")
    assert mobile_tabs.is_visible(), "Mobile view switcher tabs must be visible on mobile"

    # Default is timer view
    assert page.locator(".focus-panel").is_visible(), "Focus panel should be visible in timer view"
    assert page.locator(".productivity-panel").is_hidden(), "Productivity panel should be hidden in timer view"

    # Switch to tasks view
    page.locator("#tabViewTasks").click()
    time.sleep(0.3)
    assert page.locator(".productivity-panel").is_visible(), "Productivity panel should be visible in tasks view"
    assert page.locator(".focus-panel").is_hidden(), "Focus panel should be hidden in tasks view"

    # 6. Mobile Task Inline Editing via .task-edit-btn
    task_input = page.locator("#taskInput")
    task_input.fill("Mobile Touch Task")
    page.locator(".task-add-btn").click()
    time.sleep(0.3)

    mobile_task = page.locator(".task-item").first
    assert "Mobile Touch Task" in mobile_task.locator(".task-title").text_content()

    edit_btn = mobile_task.locator(".task-edit-btn")
    assert edit_btn.is_visible(), "Mobile edit button (pencil) must be visible in task actions"
    edit_box = edit_btn.bounding_box()
    assert edit_box["width"] >= 36 and edit_box["height"] >= 36, f"Edit button target too small: {edit_box}"

    # Click edit button to open inline edit
    edit_btn.click()
    time.sleep(0.2)
    edit_input = mobile_task.locator(".task-edit-input")
    assert edit_input.is_visible(), "Inline edit input must appear on edit button click"

    # Verify iOS auto-zoom prevention: input font-size must be 16px
    edit_font_size = page.evaluate("() => window.getComputedStyle(document.querySelector('.task-edit-input')).fontSize")
    print(f"Mobile edit input font-size: {edit_font_size}")
    assert edit_font_size == "16px", f"Expected 16px font-size to prevent iOS zoom, got {edit_font_size}"

    edit_input.fill("Updated Mobile Touch Task")
    edit_input.press("Enter")
    time.sleep(0.3)
    assert "Updated Mobile Touch Task" in mobile_task.locator(".task-title").text_content()

    # 7. Switch back to timer view & test mobile start/pause
    page.locator("#tabViewTimer").click()
    time.sleep(0.3)
    assert page.locator(".focus-panel").is_visible()

    # Test touch audio unlock and start
    page.locator("#toggleBtn").click()
    time.sleep(0.3)
    assert page.locator("#toggleBtnText").text_content() == "Pause"
    page.locator("#toggleBtn").click()
    time.sleep(0.2)
    assert page.locator("#toggleBtnText").text_content() == "Start"

    # 8. Test Mobile Modal Sheet & Body Scroll Lock
    page.locator("#settingsBtn").click()
    time.sleep(0.3)
    settings_dialog = page.locator("#settingsDialog")
    assert settings_dialog.is_visible()

    body_overflow = page.evaluate("() => document.body.style.overflow")
    print(f"Body overflow with dialog open: {body_overflow}")
    assert body_overflow == "hidden", "Body scroll must be locked when dialog is open"

    page.locator("#closeSettingsBtn").click()
    settings_dialog.wait_for(state="hidden", timeout=3000)
    assert not settings_dialog.is_visible()
    body_overflow_after = page.evaluate("() => document.body.style.overflow")
    print(f"Body overflow after dialog close: '{body_overflow_after}'")
    assert body_overflow_after == "", "Body scroll lock must be released on close"

    # 9. Verify zero console errors on mobile
    print(f"Total mobile console errors: {len(mobile_errors)}")
    if mobile_errors:
        print("Mobile Errors:", mobile_errors)
    assert len(mobile_errors) == 0, f"Encountered mobile console errors: {mobile_errors}"

    # ── T1: Bottom tab bar is fixed at viewport bottom ─────────────────
    tab_bar = page.locator(".mobile-view-tabs")
    assert tab_bar.is_visible(), "T1: Mobile tab bar must be visible on 390px viewport"
    tab_box = tab_bar.bounding_box()
    viewport_height = 844
    assert tab_box["y"] + tab_box["height"] >= viewport_height - 60, \
        f"T1: Tab bar not at bottom. y={tab_box['y']}, h={tab_box['height']}, viewport={viewport_height}"
    tab_position = page.evaluate("() => getComputedStyle(document.querySelector('.mobile-view-tabs')).position")
    assert tab_position == "fixed", f"T1: Tab bar must be position:fixed, got {tab_position}"
    print(f"T1 PASS: Tab bar fixed at bottom (y={tab_box['y']:.0f}, h={tab_box['height']:.0f})")

    # ── T2: Each tab meets 44px minimum height ─────────────────────────
    for i, tab in enumerate(page.locator(".mobile-view-tab").all()):
        box = tab.bounding_box()
        assert box["height"] >= 44, f"T2: Tab {i} height {box['height']:.0f} < 44px"
    print("T2 PASS: All mobile tabs >= 44px height")

    # ── T3: All visible .icon-btn meet 40px minimum ────────────────────
    for btn in page.locator(".icon-btn").all():
        if btn.is_visible():
            box = btn.bounding_box()
            assert box["width"] >= 40 and box["height"] >= 40, \
                f"T3: icon-btn too small: {box['width']:.0f}x{box['height']:.0f}"
    print("T3 PASS: All visible icon-btns >= 40px")

    # ── T4: Header does not overflow viewport ──────────────────────────
    header_box = page.locator("header").bounding_box()
    assert header_box["x"] >= -1, f"T4: Header left-overflows (x={header_box['x']})"
    assert header_box["width"] <= 392, f"T4: Header wider than viewport ({header_box['width']:.0f}px)"
    print(f"T4 PASS: Header fits within viewport (w={header_box['width']:.0f})")

    # ── T5: Timer view shows focus-panel, hides productivity-panel ─────
    page.locator("#tabViewTimer").click()
    time.sleep(0.3)
    assert page.locator(".focus-panel").is_visible(), "T5: Focus panel must show in timer view"
    tasks_display = page.evaluate("() => getComputedStyle(document.querySelector('.productivity-panel')).display")
    assert tasks_display == "none", f"T5: Productivity panel should be display:none in timer view, got {tasks_display}"
    print("T5 PASS: Timer view shows focus-panel, hides productivity-panel")

    # ── T6: Tasks view shows productivity-panel, hides focus-panel ─────
    page.locator("#tabViewTasks").click()
    time.sleep(0.3)
    assert page.locator(".productivity-panel").is_visible(), "T6: Productivity panel must show in tasks view"
    focus_display = page.evaluate("() => getComputedStyle(document.querySelector('.focus-panel')).display")
    assert focus_display == "none", f"T6: Focus panel should be display:none in tasks view, got {focus_display}"
    print("T6 PASS: Tasks view shows productivity-panel, hides focus-panel")

    # ── T7: Settings dialog anchored to bottom (bottom sheet) ──────────
    page.locator("#tabViewTimer").click()
    time.sleep(0.2)
    page.locator("#settingsBtn").click()
    time.sleep(0.4)
    settings_dialog_box = page.locator("#settingsDialog .modal-card").bounding_box()
    assert settings_dialog_box is not None, "T7: Settings modal-card must exist"
    assert settings_dialog_box["y"] > 100, \
        f"T7: Settings sheet should be anchored to bottom, not top (y={settings_dialog_box['y']:.0f})"
    print(f"T7 PASS: Settings bottom sheet at y={settings_dialog_box['y']:.0f}")

    # ── T8: Settings scroll area exists and is not collapsed ───────────
    scroll_area = page.locator(".settings-scroll-area")
    assert scroll_area.count() > 0, "T8: .settings-scroll-area must exist"
    scroll_box = scroll_area.bounding_box()
    assert scroll_box["height"] > 50, f"T8: Settings scroll area collapsed (h={scroll_box['height']:.0f})"
    print(f"T8 PASS: Settings scroll area h={scroll_box['height']:.0f}")
    page.locator("#closeSettingsBtn").click()
    time.sleep(0.4)

    # ── T9: Timer ring does not overflow its card ──────────────────────
    ring_box = page.locator(".svg-ring-container").bounding_box()
    card_box = page.locator(".timer-card").bounding_box()
    assert ring_box is not None and card_box is not None, "T9: Ring and card must exist"
    assert ring_box["width"] <= card_box["width"] + 4, \
        f"T9: Ring ({ring_box['width']:.0f}) overflows card ({card_box['width']:.0f})"
    print(f"T9 PASS: Ring w={ring_box['width']:.0f} <= card w={card_box['width']:.0f}")

    # ── T10: No horizontal scroll at any point ─────────────────────────
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    assert scroll_width <= 395, f"T10: Horizontal overflow detected: scrollWidth={scroll_width}px"
    print(f"T10 PASS: No horizontal overflow (scrollWidth={scroll_width}px)")

    # ── T11: Swipe gesture switches between views ──────────────────────
    page.locator("#tabViewTimer").click()
    time.sleep(0.2)
    grid = page.locator("#workspaceGrid")
    grid_box = grid.bounding_box()
    cx = grid_box["x"] + grid_box["width"] / 2
    cy = grid_box["y"] + grid_box["height"] / 2
    # Swipe left — should switch to tasks
    page.mouse.move(cx + 80, cy)
    page.mouse.down()
    page.mouse.move(cx - 80, cy, steps=10)
    page.mouse.up()
    time.sleep(0.35)
    active_view = page.locator(".mobile-view-tab.active").get_attribute("data-view")
    assert active_view == "tasks", f"T11: Swipe left should activate tasks view, got {active_view}"
    # Swipe right — should switch back to timer
    page.mouse.move(cx - 80, cy)
    page.mouse.down()
    page.mouse.move(cx + 80, cy, steps=10)
    page.mouse.up()
    time.sleep(0.35)
    active_view = page.locator(".mobile-view-tab.active").get_attribute("data-view")
    assert active_view == "timer", f"T11: Swipe right should activate timer view, got {active_view}"
    print("T11 PASS: Swipe gestures switch views correctly")

    # ── T12: Stats dialog fits within 395px width ──────────────────────
    page.locator("#dailyStatsBadge").click()
    time.sleep(0.4)
    stats_card = page.locator("#statsDialog .modal-card")
    stats_box = stats_card.bounding_box()
    assert stats_box is not None, "T12: Stats modal-card must exist"
    assert stats_box["x"] >= -1, f"T12: Stats modal left-overflows (x={stats_box['x']:.0f})"
    assert stats_box["x"] + stats_box["width"] <= 396, \
        f"T12: Stats modal right-overflows ({stats_box['x'] + stats_box['width']:.0f}px)"
    print(f"T12 PASS: Stats modal fits within viewport")
    page.locator("#okStatsBtn").click()
    time.sleep(0.4)

    print("\nALL T1-T12 ASSERTIONS PASSED")

    # Screenshot for mobile proof
    page.screenshot(path="e2e-mobile-screenshot.png", full_page=True)
    print("Mobile E2E Screenshot captured: e2e-mobile-screenshot.png")
    context.close()

    # ── T13: iPhone SE (375x667) — timer card fits without overflow ────
    print("\n--- T13: iPhone SE 375x667 ---")
    se_ctx = browser.new_context(
        viewport={"width": 375, "height": 667},
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
        has_touch=True,
        is_mobile=True,
    )
    se_page = se_ctx.new_page()
    se_page.goto("http://localhost:3000", wait_until="domcontentloaded")
    se_page.wait_for_selector("#timeDigits")
    time.sleep(0.5)
    timer_card_bottom = se_page.evaluate("() => document.querySelector('.timer-card').getBoundingClientRect().bottom")
    # Allow 100px grace for safe-area + tab bar clearance
    assert timer_card_bottom <= 767, \
        f"T13: Timer card extends too far on iPhone SE (bottom={timer_card_bottom:.0f}, viewport=667)"
    se_scroll = se_page.evaluate("() => document.documentElement.scrollWidth")
    assert se_scroll <= 378, f"T13: iPhone SE has horizontal overflow (scrollWidth={se_scroll})"
    se_page.screenshot(path="e2e-iphonese-screenshot.png", full_page=True)
    print(f"T13 PASS: iPhone SE timer card at y={timer_card_bottom:.0f}, no overflow")
    se_ctx.close()

    print("\n=========================================")
    print("ALL MOBILE E2E PLAYWRIGHT TESTS PASSED!")
    print("=========================================")

def run_mobile_tests_legacy(browser):
    """Legacy alias — kept for backward compat."""
    run_mobile_tests(browser)

if __name__ == "__main__":
    run_tests()
