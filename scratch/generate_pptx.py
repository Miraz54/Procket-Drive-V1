import os
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def build_presentation():
    prs = Presentation()
    # 16:9 widescreen dimensions (13.333" x 7.5")
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Professional Academic Color Palette (Northern University Bangladesh theme)
    C_NAVY_DARK = RGBColor(9, 18, 38)        # #091226 Deep Navy
    C_NAVY_CARD = RGBColor(17, 32, 70)       # #112046 Card Navy
    C_WHITE = RGBColor(255, 255, 255)
    C_TEXT_DARK = RGBColor(15, 23, 42)       # #0F172A Slate 900
    C_TEXT_MUTED = RGBColor(71, 85, 105)     # #475569 Slate 600
    C_CARD_BG = RGBColor(248, 250, 252)      # #F8FAFC Light Slate
    C_BORDER = RGBColor(226, 232, 240)       # #E2E8F0 Subtle Border
    
    # Speaker theme colors (Strictly clean professional badges, NO AI EMOJIS)
    C_GREEN_PRIMARY = RGBColor(21, 128, 61)   # #15803D (Ruma Ahmed Ety)
    C_GREEN_BG = RGBColor(236, 253, 245)      # #ECFDF5
    C_GREEN_BORDER = RGBColor(167, 243, 208)  # #A7F3D0

    C_BLUE_PRIMARY = RGBColor(29, 78, 216)    # #1D4ED8 (Md. Mirazul Alam)
    C_BLUE_BG = RGBColor(239, 246, 255)       # #EFF6FF
    C_BLUE_BORDER = RGBColor(191, 219, 254)   # #BFDBFE

    C_RED_BG = RGBColor(254, 242, 242)
    C_RED_BORDER = RGBColor(254, 202, 202)
    C_RED_TEXT = RGBColor(185, 28, 28)

    C_PURPLE = RGBColor(109, 40, 217)
    C_PURPLE_BG = RGBColor(245, 243, 255)

    logo_path = r"c:\Users\Miraz\Documents\GitHub\Procket-Drive-V1\public\nub-logo.png"

    def set_background(slide, color):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = color
        bg.line.fill.background()
        return bg

    def add_slide_header(slide, pre_tag, main_title, speaker_name, slide_num):
        # 1. Pre-tag (Category)
        tb_tag = slide.shapes.add_textbox(Inches(0.8), Inches(0.35), Inches(5.8), Inches(0.28))
        p_tag = tb_tag.text_frame.paragraphs[0]
        p_tag.text = pre_tag.upper()
        p_tag.font.size = Pt(9.5)
        p_tag.font.bold = True
        p_tag.font.color.rgb = C_GREEN_PRIMARY if "Ruma" in speaker_name else C_BLUE_PRIMARY

        # 2. Main Title
        tb_title = slide.shapes.add_textbox(Inches(0.8), Inches(0.60), Inches(6.4), Inches(0.60))
        p_title = tb_title.text_frame.paragraphs[0]
        p_title.text = main_title
        p_title.font.size = Pt(20)
        p_title.font.bold = True
        p_title.font.color.rgb = C_NAVY_DARK

        # 3. Speaker Badge Pill (Clean text, NO EMOJIS)
        badge_w = Inches(3.1)
        badge_h = Inches(0.42)
        badge_l = Inches(7.35)
        badge_t = Inches(0.48)

        badge = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, badge_l, badge_t, badge_w, badge_h)
        badge.fill.solid()
        if "Ruma" in speaker_name:
            badge.fill.fore_color.rgb = C_GREEN_BG
            badge.line.color.rgb = C_GREEN_BORDER
            b_text = f"Speaker: {speaker_name}"
            b_color = C_GREEN_PRIMARY
        else:
            badge.fill.fore_color.rgb = C_BLUE_BG
            badge.line.color.rgb = C_BLUE_BORDER
            b_text = f"Speaker: {speaker_name}"
            b_color = C_BLUE_PRIMARY

        tf_b = badge.text_frame
        tf_b.vertical_anchor = MSO_ANCHOR.MIDDLE
        pb = tf_b.paragraphs[0]
        pb.text = b_text
        pb.font.size = Pt(10.5)
        pb.font.bold = True
        pb.font.color.rgb = b_color
        pb.alignment = PP_ALIGN.CENTER

        # 4. University Logo Container on Header Top-Right (Aspect ratio 3.261 strictly preserved)
        if os.path.exists(logo_path):
            card_w = Inches(1.85)
            card_h = Inches(0.64)
            card_l = Inches(10.68)
            card_t = Inches(0.38)
            
            l_bg = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, card_l, card_t, card_w, card_h)
            l_bg.fill.solid()
            l_bg.fill.fore_color.rgb = C_WHITE
            l_bg.line.color.rgb = C_BORDER
            
            pic_w = Inches(1.65)
            pic_h = Inches(1.65 / 3.2611)  # ~0.506 in
            pic_l = Inches(10.78)
            pic_t = Inches(0.44)
            slide.shapes.add_picture(logo_path, pic_l, pic_t, width=pic_w, height=pic_h)

        # 5. Divider Line
        div = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.22), Inches(11.733), Inches(0.015))
        div.fill.solid()
        div.fill.fore_color.rgb = C_BORDER
        div.line.fill.background()

        # 6. Clean Academic Footer
        tb_foot = slide.shapes.add_textbox(Inches(0.8), Inches(6.92), Inches(10.5), Inches(0.30))
        pf = tb_foot.text_frame.paragraphs[0]
        pf.text = "Pocket Drive • Northern University Bangladesh • Department of Computer Science & Engineering"
        pf.font.size = Pt(9)
        pf.font.color.rgb = C_TEXT_MUTED

        # 7. Slide Number
        tb_num = slide.shapes.add_textbox(Inches(11.8), Inches(6.90), Inches(0.733), Inches(0.30))
        pn = tb_num.text_frame.paragraphs[0]
        pn.text = f"{slide_num:02d} / 12"
        pn.font.size = Pt(10)
        pn.font.bold = True
        pn.font.color.rgb = C_NAVY_DARK
        pn.alignment = PP_ALIGN.RIGHT

    # =========================================================================
    # SLIDE 1: COVER SLIDE (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    set_background(s1, C_NAVY_DARK)

    # University Logo on Top Left with Generous White Container
    if os.path.exists(logo_path):
        logo_card_w = Inches(3.6)
        logo_card_h = Inches(1.15)
        lc = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.50), logo_card_w, logo_card_h)
        lc.fill.solid()
        lc.fill.fore_color.rgb = C_WHITE
        lc.line.fill.background()
        
        # Exact picture placement: perfectly centered inside white box
        s1.shapes.add_picture(logo_path, Inches(0.95), Inches(0.58), width=Inches(3.3), height=Inches(3.3 / 3.2611))

    # University & Department text immediately next to the Logo
    tb_dept = s1.shapes.add_textbox(Inches(4.6), Inches(0.50), Inches(5.0), Inches(1.15))
    tf_dept = tb_dept.text_frame
    tf_dept.word_wrap = True
    p_d1 = tf_dept.paragraphs[0]
    p_d1.text = "NORTHERN UNIVERSITY BANGLADESH"
    p_d1.font.size = Pt(15)
    p_d1.font.bold = True
    p_d1.font.color.rgb = C_WHITE

    p_d2 = tf_dept.add_paragraph()
    p_d2.text = "Department of Computer Science & Engineering"
    p_d2.font.size = Pt(11.5)
    p_d2.font.bold = True
    p_d2.font.color.rgb = RGBColor(56, 189, 248)

    p_d3 = tf_dept.add_paragraph()
    p_d3.text = "Undergraduate Project Defense & Technical Evaluation"
    p_d3.font.size = Pt(9.5)
    p_d3.font.color.rgb = RGBColor(148, 163, 184)

    # Speaker Badge Pill on Top Right
    sb1 = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.8), Inches(0.52), Inches(2.733), Inches(0.44))
    sb1.fill.solid()
    sb1.fill.fore_color.rgb = RGBColor(20, 83, 45)
    sb1.line.color.rgb = RGBColor(74, 222, 128)
    tf_sb1 = sb1.text_frame
    tf_sb1.vertical_anchor = MSO_ANCHOR.MIDDLE
    p_sb1 = tf_sb1.paragraphs[0]
    p_sb1.text = "Speaker: Ruma Ahmed Ety"
    p_sb1.font.size = Pt(10.5)
    p_sb1.font.bold = True
    p_sb1.font.color.rgb = RGBColor(220, 252, 231)
    p_sb1.alignment = PP_ALIGN.CENTER

    # Project Title Section (Starting at top=1.95" with clean space)
    tb_hero = s1.shapes.add_textbox(Inches(0.8), Inches(1.95), Inches(11.733), Inches(2.0))
    tf_hero = tb_hero.text_frame
    tf_hero.word_wrap = True

    ph1 = tf_hero.paragraphs[0]
    ph1.text = "ACADEMIC FINAL DEFENSE PRESENTATION • CSE"
    ph1.font.size = Pt(11)
    ph1.font.bold = True
    ph1.font.color.rgb = RGBColor(74, 222, 128)

    ph2 = tf_hero.add_paragraph()
    ph2.text = "POCKET DRIVE"
    ph2.font.size = Pt(44)
    ph2.font.bold = True
    ph2.font.color.rgb = C_WHITE

    ph3 = tf_hero.add_paragraph()
    ph3.text = "A Secure Cloud Storage System with Built-in AI Document Tools and Private Vault Security"
    ph3.font.size = Pt(14)
    ph3.font.color.rgb = RGBColor(203, 213, 225)

    # Bottom Meta Box (Students & Supervisor)
    mb = s1.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(4.30), Inches(11.733), Inches(2.50))
    mb.fill.solid()
    mb.fill.fore_color.rgb = C_NAVY_CARD
    mb.line.color.rgb = RGBColor(51, 65, 85)

    # Left Column: Submitted By (Presenter Roles clearly divided)
    tb_sub = s1.shapes.add_textbox(Inches(1.1), Inches(4.45), Inches(6.0), Inches(2.1))
    tf_sub = tb_sub.text_frame
    tf_sub.word_wrap = True
    ps_h = tf_sub.paragraphs[0]
    ps_h.text = "SUBMITTED BY:"
    ps_h.font.size = Pt(11)
    ps_h.font.bold = True
    ps_h.font.color.rgb = RGBColor(56, 189, 248)

    ps1 = tf_sub.add_paragraph()
    ps1.text = "• Ruma Ahmed Ety  |  Roll: 42220300303"
    ps1.font.size = Pt(12.5)
    ps1.font.bold = True
    ps1.font.color.rgb = C_WHITE

    ps1_sub = tf_sub.add_paragraph()
    ps1_sub.text = "   Role: Documentation & Testing Assistant (Presents Part 1: Slides 1 to 6)"
    ps1_sub.font.size = Pt(9.5)
    ps1_sub.font.color.rgb = RGBColor(148, 163, 184)

    ps2 = tf_sub.add_paragraph()
    ps2.text = "• Md. Mirazul Alam  |  Roll: 42220300225"
    ps2.font.size = Pt(12.5)
    ps2.font.bold = True
    ps2.font.color.rgb = C_WHITE

    ps2_sub = tf_sub.add_paragraph()
    ps2_sub.text = "   Role: Lead Developer (Presents Part 2: Slides 7 to 12)"
    ps2_sub.font.size = Pt(9.5)
    ps2_sub.font.color.rgb = RGBColor(148, 163, 184)

    # Right Column: Supervised By
    tb_sup = s1.shapes.add_textbox(Inches(7.4), Inches(4.45), Inches(4.8), Inches(2.1))
    tf_sup = tb_sup.text_frame
    tf_sup.word_wrap = True
    psp_h = tf_sup.paragraphs[0]
    psp_h.text = "SUPERVISED BY:"
    psp_h.font.size = Pt(11)
    psp_h.font.bold = True
    psp_h.font.color.rgb = RGBColor(74, 222, 128)

    psp1 = tf_sup.add_paragraph()
    psp1.text = "Malyha Bintha Mabud"
    psp1.font.size = Pt(14)
    psp1.font.bold = True
    psp1.font.color.rgb = C_WHITE

    psp2 = tf_sup.add_paragraph()
    psp2.text = "Lecturer, Department of Computer Science & Engineering"
    psp2.font.size = Pt(11)
    psp2.font.color.rgb = RGBColor(203, 213, 225)

    psp3 = tf_sup.add_paragraph()
    psp3.text = "Northern University Bangladesh"
    psp3.font.size = Pt(11)
    psp3.font.bold = True
    psp3.font.color.rgb = RGBColor(96, 165, 250)

    # =========================================================================
    # SLIDE 2: WHAT IS POCKET DRIVE (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    set_background(s2, C_WHITE)
    add_slide_header(s2, "Project Overview", "What is Pocket Drive?", "Ruma Ahmed Ety", 2)

    col_w = Inches(3.64)
    y_card = Inches(1.50)
    h_card = Inches(5.15)

    cards_s2 = [
        ("Core Cloud Storage", C_BLUE_PRIMARY, C_BLUE_BG, [
            ("Academic Cloud for Students:", "A fast and lightweight cloud storage platform created for university students and teachers to store lecture notes, assignments, code, and media."),
            ("Wide Format Compatibility:", "Upload, organize, and download lecture notes, PDFs, Word docs, photos, audio, and source code files."),
            ("In-Browser File Inspection:", "Instantly preview PDFs, images, text documents, and audio directly inside the browser with zero external viewer software required.")
        ]),
        ("Private Security Vault", C_PURPLE, C_PURPLE_BG, [
            ("Dedicated Privacy Barrier:", "A specialized second-layer vault secured by an independent 4-digit PIN that remains locked even when logged in."),
            ("Protects Sensitive Records:", "Keeps national IDs, certificates, academic grade transcripts, and passwords safe from roommates and peers in public labs."),
            ("Strict Query Concealment:", "Files inside the Vault are completely excluded from normal file queries and regular drive search results.")
        ]),
        ("Integrated AI Utilities", C_GREEN_PRIMARY, C_GREEN_BG, [
            ("Eliminates External Ad Sites:", "Users no longer need to upload sensitive files to suspicious third-party document converter websites."),
            ("1-Click PDF Generation:", "Converts Word documents and photos to standard A4 PDFs with native Bengali Kalpurush font rendering."),
            ("Smart OCR & Summarization:", "Extracts text from lecture whiteboard photos and summarizes lengthy 20-page papers in 3 seconds.")
        ])
    ]

    for i, (ctitle, ccolor, cbg, points) in enumerate(cards_s2):
        x = Inches(0.8 + i * (3.64 + 0.4))
        c = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y_card, col_w, h_card)
        c.fill.solid()
        c.fill.fore_color.rgb = C_CARD_BG
        c.line.color.rgb = C_BORDER

        hb = s2.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + Inches(0.15), y_card + Inches(0.2), col_w - Inches(0.3), Inches(0.55))
        hb.fill.solid()
        hb.fill.fore_color.rgb = cbg
        hb.line.color.rgb = C_BORDER
        p_hb = hb.text_frame.paragraphs[0]
        p_hb.text = ctitle
        p_hb.font.size = Pt(13)
        p_hb.font.bold = True
        p_hb.font.color.rgb = ccolor
        p_hb.alignment = PP_ALIGN.CENTER

        tb = s2.shapes.add_textbox(x + Inches(0.15), y_card + Inches(0.90), col_w - Inches(0.3), Inches(4.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for bold_txt, norm_txt in points:
            p = tf.add_paragraph() if tf.paragraphs[0].text else tf.paragraphs[0]
            p.text = f"• {bold_txt}"
            p.font.size = Pt(10.5)
            p.font.bold = True
            p.font.color.rgb = C_NAVY_DARK

            p_desc = tf.add_paragraph()
            p_desc.text = f"  {norm_txt}\n"
            p_desc.font.size = Pt(9.5)
            p_desc.font.color.rgb = C_TEXT_MUTED

    # =========================================================================
    # SLIDE 3: PROBLEM STATEMENT & SOLUTIONS (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    set_background(s3, C_WHITE)
    add_slide_header(s3, "Problem Statement", "Everyday User Challenges & Our Solutions", "Ruma Ahmed Ety", 3)

    col2_w = Inches(5.66)
    y_split = Inches(1.50)
    h_split = Inches(5.15)

    # Left: Problems
    p_box = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), y_split, col2_w, h_split)
    p_box.fill.solid()
    p_box.fill.fore_color.rgb = C_RED_BG
    p_box.line.color.rgb = C_RED_BORDER

    tb_p = s3.shapes.add_textbox(Inches(1.05), y_split + Inches(0.2), col2_w - Inches(0.5), h_split - Inches(0.4))
    tf_p = tb_p.text_frame
    tf_p.word_wrap = True
    pp1 = tf_p.paragraphs[0]
    pp1.text = "Student Difficulties with Existing Drives"
    pp1.font.size = Pt(14)
    pp1.font.bold = True
    pp1.font.color.rgb = C_RED_TEXT

    prob_items = [
        ("Risky Third-Party Websites:", "Students regularly visit ad-heavy, suspicious third-party sites just to convert Word docs to PDF or extract text from slides, risking personal data."),
        ("No Secondary PIN Protection:", "Leaving a laptop unlocked in a university lab or library exposes confidential academic and personal files to anyone nearby."),
        ("Document Reading Overload:", "Reading lengthy 30-page research publications or reports just to understand key takeaways consumes hours of valuable study time.")
    ]
    for h, desc in prob_items:
        p_h = tf_p.add_paragraph()
        p_h.text = f"\n• {h}"
        p_h.font.size = Pt(11)
        p_h.font.bold = True
        p_h.font.color.rgb = C_RED_TEXT

        p_d = tf_p.add_paragraph()
        p_d.text = f"  {desc}"
        p_d.font.size = Pt(10)
        p_d.font.color.rgb = C_TEXT_DARK

    # Right: Solutions
    s_box = s3.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.86), y_split, col2_w, h_split)
    s_box.fill.solid()
    s_box.fill.fore_color.rgb = C_GREEN_BG
    s_box.line.color.rgb = C_GREEN_BORDER

    tb_s = s3.shapes.add_textbox(Inches(7.11), y_split + Inches(0.2), col2_w - Inches(0.5), h_split - Inches(0.4))
    tf_s = tb_s.text_frame
    tf_s.word_wrap = True
    sp1 = tf_s.paragraphs[0]
    sp1.text = "How Pocket Drive Solves These Challenges"
    sp1.font.size = Pt(14)
    sp1.font.bold = True
    sp1.font.color.rgb = C_GREEN_PRIMARY

    sol_items = [
        ("Unified All-in-One Dashboard:", "File storage, PDF conversion, text OCR scanning, and document summaries happen inside one clean, unified workspace."),
        ("Isolated 4-Digit PIN Vault:", "Sensitive files remain strictly locked behind an independent 4-digit PIN even when your main account remains open on screen."),
        ("Instant Gemini AI Summaries:", "Google Gemini extracts main topics, key points, and conclusions in 3 seconds, saving researchers and students massive time.")
    ]
    for h, desc in sol_items:
        p_h = tf_s.add_paragraph()
        p_h.text = f"\n• {h}"
        p_h.font.size = Pt(11)
        p_h.font.bold = True
        p_h.font.color.rgb = C_GREEN_PRIMARY

        p_d = tf_s.add_paragraph()
        p_d.text = f"  {desc}"
        p_d.font.size = Pt(10)
        p_d.font.color.rgb = C_TEXT_DARK

    # =========================================================================
    # SLIDE 4: SYSTEM OBJECTIVES (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    set_background(s4, C_WHITE)
    add_slide_header(s4, "System Goals", "Primary Objectives of the System", "Ruma Ahmed Ety", 4)

    col4_w = Inches(2.7)
    obj_data = [
        ("1. Organization", C_BLUE_PRIMARY, C_BLUE_BG, [
            ("Drag-and-Drop:", "Fast file uploading with dynamic byte tracking."),
            ("Folder Nesting:", "Hierarchical directory structure with breadcrumb paths."),
            ("Live Search:", "Real-time instant filtering as the user types each letter."),
            ("Universal Viewer:", "In-browser inspection for PDF, images, video, and audio.")
        ]),
        ("2. Vault Privacy", C_PURPLE, C_PURPLE_BG, [
            ("Dual-Layer Defense:", "Second-layer 4-digit PIN verification."),
            ("Bcrypt Hashing:", "PINs are securely hashed and salted in the database."),
            ("Query Concealment:", "Vault files are hidden from regular API results."),
            ("Manual Re-Lock:", "Instant lock button when stepping away from the desk.")
        ]),
        ("3. AI Productivity", C_GREEN_PRIMARY, C_GREEN_BG, [
            ("PDF Generation:", "1-Click Word (.docx) and Image to PDF creation."),
            ("Bengali Typography:", "Embedded Kalpurush font prevents broken ligatures."),
            ("Photo Text OCR:", "Extracts readable text from whiteboard photos."),
            ("Smart Summaries:", "Instant key bullet points from long research papers.")
        ]),
        ("4. Safe Recovery", RGBColor(180, 83, 9), RGBColor(254, 243, 199), [
            ("Accidental Loss Guard:", "Deleted items wait safely in Recycle Bin."),
            ("Soft-Delete Flag:", "Retains original file states and parent folder links."),
            ("1-Click Restoration:", "Restores files directly back to their original folder."),
            ("Permanent Removal:", "Allows clearing storage space permanently.")
        ])
    ]

    for i, (otitle, ocolor, obg, opoints) in enumerate(obj_data):
        x = Inches(0.8 + i * (2.7 + 0.31))
        c = s4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y_card, col4_w, h_card)
        c.fill.solid()
        c.fill.fore_color.rgb = C_CARD_BG
        c.line.color.rgb = C_BORDER

        hb = s4.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + Inches(0.12), y_card + Inches(0.2), col4_w - Inches(0.24), Inches(0.55))
        hb.fill.solid()
        hb.fill.fore_color.rgb = obg
        hb.line.color.rgb = C_BORDER
        p_hb = hb.text_frame.paragraphs[0]
        p_hb.text = otitle
        p_hb.font.size = Pt(12)
        p_hb.font.bold = True
        p_hb.font.color.rgb = ocolor
        p_hb.alignment = PP_ALIGN.CENTER

        tb = s4.shapes.add_textbox(x + Inches(0.12), y_card + Inches(0.9), col4_w - Inches(0.24), Inches(4.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for bold_txt, norm_txt in opoints:
            p = tf.add_paragraph() if tf.paragraphs[0].text else tf.paragraphs[0]
            p.text = f"• {bold_txt}"
            p.font.size = Pt(10)
            p.font.bold = True
            p.font.color.rgb = C_NAVY_DARK

            pd = tf.add_paragraph()
            pd.text = f"  {norm_txt}\n"
            pd.font.size = Pt(9.5)
            pd.font.color.rgb = C_TEXT_MUTED

    # =========================================================================
    # SLIDE 5: USER DASHBOARD & REAL CHROME SCREENSHOT (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    set_background(s5, C_WHITE)
    add_slide_header(s5, "User Experience", "User Dashboard & Mobile QR Sharing", "Ruma Ahmed Ety", 5)

    dashboard_img = r"C:\Users\Miraz\.gemini\antigravity-ide\brain\9eb7ba71-a66c-4086-9fe2-b3da3229b93c\.user_uploaded\media_1792256099012.png"

    # Left: Real Live Screenshot in Sleek Bordered Frame
    w_img = Inches(7.8)
    h_img = Inches(7.8 / 1.8652) # ~4.18 in
    x_img = Inches(0.8)
    y_img = Inches(1.48)

    c_img = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_img, y_img, w_img + Inches(0.2), h_img + Inches(0.2))
    c_img.fill.solid()
    c_img.fill.fore_color.rgb = C_WHITE
    c_img.line.color.rgb = RGBColor(203, 213, 225)

    if os.path.exists(dashboard_img):
        s5.shapes.add_picture(dashboard_img, x_img + Inches(0.1), y_img + Inches(0.1), width=w_img, height=h_img)

    # Real Dashboard Status Pill below the screenshot
    y_pill = y_img + h_img + Inches(0.28)
    c_pill = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_img, y_pill, w_img + Inches(0.2), Inches(0.70))
    c_pill.fill.solid()
    c_pill.fill.fore_color.rgb = C_CARD_BG
    c_pill.line.color.rgb = C_BORDER

    tb_pill = s5.shapes.add_textbox(x_img + Inches(0.15), y_pill + Inches(0.06), w_img - Inches(0.1), Inches(0.58))
    tf_pill = tb_pill.text_frame
    tf_pill.word_wrap = True

    p_p1 = tf_pill.paragraphs[0]
    p_p1.text = "Live Production Web App: https://pocket-drive-v1.vercel.app  •  Platform: Windows 11 Google Chrome"
    p_p1.font.size = Pt(10)
    p_p1.font.bold = True
    p_p1.font.color.rgb = C_BLUE_PRIMARY

    p_p2 = tf_pill.add_paragraph()
    p_p2.text = "Real Supabase Cloud Quota: 53.44 MB / 1 GB (0.4% used)  •  42 files active  •  Max 50 MB / file"
    p_p2.font.size = Pt(9.5)
    p_p2.font.color.rgb = C_TEXT_DARK

    # Right: Features & QR Code Cards
    x_r = Inches(9.0)
    w_r = Inches(3.533)

    c_qr = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_r, y_img, w_r, Inches(2.55))
    c_qr.fill.solid()
    c_qr.fill.fore_color.rgb = C_CARD_BG
    c_qr.line.color.rgb = C_BORDER

    hb_qr = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_r + Inches(0.12), y_img + Inches(0.15), w_r - Inches(0.24), Inches(0.48))
    hb_qr.fill.solid()
    hb_qr.fill.fore_color.rgb = C_GREEN_BG
    hb_qr.line.color.rgb = C_BORDER
    p_hqr = hb_qr.text_frame.paragraphs[0]
    p_hqr.text = "Live Dashboard Features"
    p_hqr.font.size = Pt(11)
    p_hqr.font.bold = True
    p_hqr.font.color.rgb = C_GREEN_PRIMARY
    p_hqr.alignment = PP_ALIGN.CENTER

    tb_qr = s5.shapes.add_textbox(x_r + Inches(0.15), y_img + Inches(0.70), w_r - Inches(0.3), Inches(1.7))
    tf_qr = tb_qr.text_frame
    tf_qr.word_wrap = True

    pts_ui = [
        ("Nested Folder Paths:", "Breadcrumb navigation with instantaneous folder nesting."),
        ("Instant Live Search:", "Filters files in real time as the user types each character."),
        ("Direct File Inspection:", "Immediate preview of PDFs, images, documents, and audio files.")
    ]
    for bh, bd in pts_ui:
        p = tf_qr.add_paragraph() if tf_qr.paragraphs[0].text else tf_qr.paragraphs[0]
        p.text = f"• {bh} {bd}"
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_TEXT_DARK

    # Bottom Right Card: Instant QR Sharing & Storage Limit
    y_sto = y_img + Inches(2.70)
    c_sto = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_r, y_sto, w_r, Inches(2.45))
    c_sto.fill.solid()
    c_sto.fill.fore_color.rgb = C_CARD_BG
    c_sto.line.color.rgb = C_BORDER

    hb_sto = s5.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_r + Inches(0.12), y_sto + Inches(0.15), w_r - Inches(0.24), Inches(0.48))
    hb_sto.fill.solid()
    hb_sto.fill.fore_color.rgb = C_BLUE_BG
    hb_sto.line.color.rgb = C_BORDER
    p_hsto = hb_sto.text_frame.paragraphs[0]
    p_hsto.text = "Mobile QR & Cloud Quota"
    p_hsto.font.size = Pt(11)
    p_hsto.font.bold = True
    p_hsto.font.color.rgb = C_BLUE_PRIMARY
    p_hsto.alignment = PP_ALIGN.CENTER

    tb_sto = s5.shapes.add_textbox(x_r + Inches(0.15), y_sto + Inches(0.70), w_r - Inches(0.3), Inches(1.65))
    tf_sto = tb_sto.text_frame
    tf_sto.word_wrap = True

    pts_sto = [
        ("Instant Mobile QR Code:", "Dynamic QR generated for every file; students scan to download."),
        ("Real 1 GB Storage Cap:", "Supabase Cloud Free Tier quota strictly tracked without inflation."),
        ("50 MB Single File Limit:", "Individual upload cap enforced by server and client validations.")
    ]
    for bh, bd in pts_sto:
        p = tf_sto.add_paragraph() if tf_sto.paragraphs[0].text else tf_sto.paragraphs[0]
        p.text = f"• {bh} {bd}"
        p.font.size = Pt(9.5)
        p.font.color.rgb = C_TEXT_DARK

    # =========================================================================
    # SLIDE 6: TESTING, QA & HANDOVER (Speaker: Ruma Ahmed Ety)
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    set_background(s6, C_WHITE)
    add_slide_header(s6, "Quality Control", "Testing, Quality Assurance & Technical Handover", "Ruma Ahmed Ety", 6)

    w_qa = Inches(5.66)
    c_qa1 = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(1.50), w_qa, Inches(2.80))
    c_qa1.fill.solid()
    c_qa1.fill.fore_color.rgb = C_CARD_BG
    c_qa1.line.color.rgb = C_BORDER

    tb_qa1 = s6.shapes.add_textbox(Inches(1.05), Inches(1.65), w_qa - Inches(0.5), Inches(2.50))
    tf_qa1 = tb_qa1.text_frame
    tf_qa1.word_wrap = True
    p_q1 = tf_qa1.paragraphs[0]
    p_q1.text = "Functional & Usability Testing"
    p_q1.font.size = Pt(13.5)
    p_q1.font.bold = True
    p_q1.font.color.rgb = C_GREEN_PRIMARY

    qa1_items = [
        ("File Upload Capacity:", "Tested diverse file sizes from 5 KB text files up to 50 MB media files without memory crashes."),
        ("Navigation Integrity:", "Verified folder creation, file moving, breadcrumb paths, and batch file deletion."),
        ("Cross-Browser Testing:", "Validated responsive layouts across Google Chrome, Microsoft Edge, and Android/iPhone screens.")
    ]
    for h, desc in qa1_items:
        p_h = tf_qa1.add_paragraph()
        p_h.text = f"• {h} {desc}"
        p_h.font.size = Pt(10.5)
        p_h.font.color.rgb = C_TEXT_DARK

    c_qa2 = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.86), Inches(1.50), w_qa, Inches(2.80))
    c_qa2.fill.solid()
    c_qa2.fill.fore_color.rgb = C_CARD_BG
    c_qa2.line.color.rgb = C_BORDER

    tb_qa2 = s6.shapes.add_textbox(Inches(7.11), Inches(1.65), w_qa - Inches(0.5), Inches(2.50))
    tf_qa2 = tb_qa2.text_frame
    tf_qa2.word_wrap = True
    p_q2 = tf_qa2.paragraphs[0]
    p_q2.text = "Security & Error Handling Testing"
    p_q2.font.size = Pt(13.5)
    p_q2.font.bold = True
    p_q2.font.color.rgb = C_PURPLE

    qa2_items = [
        ("Vault PIN Penetration Test:", "Attempted unauthorized API calls without the 4-digit PIN; blocked 100% with 401 Unauthorized."),
        ("Password Encryption Check:", "Verified bcrypt hashes in database cannot be decrypted or viewed in plain text."),
        ("Duplicate Filename Protection:", "Uploading files with matching names automatically adds auto-numbering (e.g. notes (1).pdf).")
    ]
    for h, desc in qa2_items:
        p_h = tf_qa2.add_paragraph()
        p_h.text = f"• {h} {desc}"
        p_h.font.size = Pt(10.5)
        p_h.font.color.rgb = C_TEXT_DARK

    # Handover Banner at Bottom
    c_hand = s6.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(4.55), Inches(11.733), Inches(2.10))
    c_hand.fill.solid()
    c_hand.fill.fore_color.rgb = C_NAVY_CARD
    c_hand.line.color.rgb = C_BLUE_PRIMARY

    tb_hand = s6.shapes.add_textbox(Inches(1.2), Inches(4.7), Inches(11.0), Inches(1.7))
    tf_hand = tb_hand.text_frame
    tf_hand.word_wrap = True

    ph1 = tf_hand.paragraphs[0]
    ph1.text = "TECHNICAL HANDOVER TO LEAD DEVELOPER"
    ph1.font.size = Pt(10)
    ph1.font.bold = True
    ph1.font.color.rgb = RGBColor(96, 165, 250)

    ph2 = tf_hand.add_paragraph()
    ph2.text = "Handing Over to: Md. Mirazul Alam (Lead Developer)"
    ph2.font.size = Pt(16)
    ph2.font.bold = True
    ph2.font.color.rgb = C_WHITE

    ph3 = tf_hand.add_paragraph()
    ph3.text = "Mirazul will now explain the system architecture, Supabase PostgreSQL database design, Private Vault security encryption, and Gemini AI backend processing pipelines."
    ph3.font.size = Pt(11)
    ph3.font.color.rgb = RGBColor(203, 213, 225)

    # =========================================================================
    # SLIDE 7: SYSTEM ARCHITECTURE (Speaker: Md. Mirazul Alam)
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    set_background(s7, C_WHITE)
    add_slide_header(s7, "Backend Engineering", "System Architecture & Engineering Data Flow", "Md. Mirazul Alam", 7)

    arch_layers = [
        ("LAYER 1", "Client Browser", C_BLUE_PRIMARY, C_BLUE_BG, [
            ("Responsive Web UI:", "Single-page application built with clean HTML5, CSS3, and JavaScript."),
            ("Zero Framework Bloat:", "Ultra-fast load time without complex client dependencies."),
            ("Client Utilities:", "Integrated QRCode.js for mobile sharing and JSZip for archive downloads.")
        ]),
        ("LAYER 2", "Express API Server", C_GREEN_PRIMARY, C_GREEN_BG, [
            ("Node.js & Express:", "Manages routing, user authentication, and upload streams."),
            ("Rate Limiting:", "Express-rate-limit prevents DDoS and brute-force password spam."),
            ("Multer Streaming:", "Parses file uploads in memory for direct transfer to cloud buckets.")
        ]),
        ("LAYER 3", "AI Processing", C_PURPLE, C_PURPLE_BG, [
            ("Google Gemini API:", "Multimodal intelligence for document analysis and summarization."),
            ("Tesseract.js Engine:", "Fast local OCR text scanner from photographs."),
            ("PDF-Lib & Mammoth:", "Generates clean A4 PDFs with embedded Bengali Kalpurush font.")
        ]),
        ("LAYER 4", "Supabase Cloud", RGBColor(180, 83, 9), RGBColor(254, 243, 199), [
            ("PostgreSQL Database:", "Stores user records, file metadata, and folder trees."),
            ("Row-Level Security:", "Database policies strictly isolate files by user ID."),
            ("1 GB Cloud Buckets:", "High-availability object storage partitioned by user folders.")
        ])
    ]

    for i, (ly, ltitle, lcolor, lbg, lpoints) in enumerate(arch_layers):
        x = Inches(0.8 + i * (2.7 + 0.31))
        c = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y_card, col4_w, h_card)
        c.fill.solid()
        c.fill.fore_color.rgb = C_CARD_BG
        c.line.color.rgb = C_BORDER

        hb = s7.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + Inches(0.12), y_card + Inches(0.2), col4_w - Inches(0.24), Inches(0.65))
        hb.fill.solid()
        hb.fill.fore_color.rgb = lbg
        hb.line.color.rgb = C_BORDER
        p_l = hb.text_frame.paragraphs[0]
        p_l.text = ly
        p_l.font.size = Pt(8.5)
        p_l.font.bold = True
        p_l.font.color.rgb = lcolor
        p_l.alignment = PP_ALIGN.CENTER

        p_t = hb.text_frame.add_paragraph()
        p_t.text = ltitle
        p_t.font.size = Pt(11)
        p_t.font.bold = True
        p_t.font.color.rgb = C_NAVY_DARK
        p_t.alignment = PP_ALIGN.CENTER

        tb = s7.shapes.add_textbox(x + Inches(0.12), y_card + Inches(1.0), col4_w - Inches(0.24), Inches(4.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for bold_txt, norm_txt in lpoints:
            p = tf.add_paragraph() if tf.paragraphs[0].text else tf.paragraphs[0]
            p.text = f"• {bold_txt}"
            p.font.size = Pt(10)
            p.font.bold = True
            p.font.color.rgb = C_NAVY_DARK

            pd = tf.add_paragraph()
            pd.text = f"  {norm_txt}\n"
            pd.font.size = Pt(9.5)
            pd.font.color.rgb = C_TEXT_MUTED

    # =========================================================================
    # SLIDE 8: DATABASE & CLOUD STORAGE (Speaker: Md. Mirazul Alam)
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    set_background(s8, C_WHITE)
    add_slide_header(s8, "Cloud Backend", "Database Schema & Cloud Storage (Supabase)", "Md. Mirazul Alam", 8)

    c_db1 = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), y_split, col2_w, h_split)
    c_db1.fill.solid()
    c_db1.fill.fore_color.rgb = C_CARD_BG
    c_db1.line.color.rgb = C_BORDER

    tb_db1 = s8.shapes.add_textbox(Inches(1.05), y_split + Inches(0.2), col2_w - Inches(0.5), h_split - Inches(0.4))
    tf_db1 = tb_db1.text_frame
    tf_db1.word_wrap = True

    pd1 = tf_db1.paragraphs[0]
    pd1.text = "PostgreSQL Relational Database Schema"
    pd1.font.size = Pt(14)
    pd1.font.bold = True
    pd1.font.color.rgb = C_BLUE_PRIMARY

    db_points = [
        ("Users Table:", "Stores user credentials, emails, bcrypt-hashed passwords, and 4-digit vault PIN hashes with unique constraints."),
        ("Files Table:", "Maintains file metadata: original_name, file_size, mime_type, file_path, folder_id, and vault status."),
        ("Folders Table:", "Enables nested folder hierarchies with parent_folder_id foreign keys and cascade protections."),
        ("Soft Delete Flag:", "Uses is_deleted = 1 to safely keep deleted items in Recycle Bin until permanent deletion.")
    ]
    for h, desc in db_points:
        p_h = tf_db1.add_paragraph()
        p_h.text = f"\n• {h}"
        p_h.font.size = Pt(11)
        p_h.font.bold = True
        p_h.font.color.rgb = C_NAVY_DARK

        p_d = tf_db1.add_paragraph()
        p_d.text = f"  {desc}"
        p_d.font.size = Pt(10)
        p_d.font.color.rgb = C_TEXT_DARK

    c_db2 = s8.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.86), y_split, col2_w, h_split)
    c_db2.fill.solid()
    c_db2.fill.fore_color.rgb = C_CARD_BG
    c_db2.line.color.rgb = C_BORDER

    tb_db2 = s8.shapes.add_textbox(Inches(7.11), y_split + Inches(0.2), col2_w - Inches(0.5), h_split - Inches(0.4))
    tf_db2 = tb_db2.text_frame
    tf_db2.word_wrap = True

    pd2 = tf_db2.paragraphs[0]
    pd2.text = "Supabase Cloud Object Storage Buckets"
    pd2.font.size = Pt(14)
    pd2.font.bold = True
    pd2.font.color.rgb = C_GREEN_PRIMARY

    sto_points = [
        ("User Partitioning:", "Files are physically isolated under userfiles/{userId}/safe_filename, preventing cross-user access."),
        ("Duplicate Protection:", "Server checks existing filenames before upload, automatically numbering duplicates (e.g. notes (1).pdf)."),
        ("Honest 1 GB Quota:", "Follows Supabase Free Tier 1 GB total storage quota with a 50 MB per-file upload limit."),
        ("In-Memory Streaming:", "Multer parses file buffers in memory and streams directly to Supabase via HTTPS.")
    ]
    for h, desc in sto_points:
        p_h = tf_db2.add_paragraph()
        p_h.text = f"\n• {h}"
        p_h.font.size = Pt(11)
        p_h.font.bold = True
        p_h.font.color.rgb = C_NAVY_DARK

        p_d = tf_db2.add_paragraph()
        p_d.text = f"  {desc}"
        p_d.font.size = Pt(10)
        p_d.font.color.rgb = C_TEXT_DARK

    # =========================================================================
    # SLIDE 9: PRIVATE VAULT SECURITY (Speaker: Md. Mirazul Alam)
    # =========================================================================
    s9 = prs.slides.add_slide(blank_layout)
    set_background(s9, C_WHITE)
    add_slide_header(s9, "Security Deep Dive", "Private Vault: Two-Layer PIN Security", "Md. Mirazul Alam", 9)

    c_v1 = s9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), y_split, Inches(6.8), h_split)
    c_v1.fill.solid()
    c_v1.fill.fore_color.rgb = C_CARD_BG
    c_v1.line.color.rgb = C_BORDER

    tb_v1 = s9.shapes.add_textbox(Inches(1.05), y_split + Inches(0.2), Inches(6.3), h_split - Inches(0.4))
    tf_v1 = tb_v1.text_frame
    tf_v1.word_wrap = True

    pv1 = tf_v1.paragraphs[0]
    pv1.text = "Why Account Password is Not Enough"
    pv1.font.size = Pt(14)
    pv1.font.bold = True
    pv1.font.color.rgb = C_PURPLE

    pv_desc = tf_v1.add_paragraph()
    pv_desc.text = "In university labs or libraries, students frequently leave laptops open. If your main drive is logged in, anyone can browse your files. The Private Vault provides an independent security barrier."
    pv_desc.font.size = Pt(10.5)
    pv_desc.font.color.rgb = C_TEXT_DARK

    pv_steps = [
        ("Bcrypt PIN Hashing:", "The 4-digit PIN is salted and hashed using bcrypt. The plain text PIN is never saved in the database."),
        ("Encrypted Vault Token:", "Upon successful PIN entry, the server generates an encrypted session token with automatic expiration."),
        ("Query Isolation:", "Normal drive API queries strictly filter out vault files (is_vault = false). Vault records are invisible without the token."),
        ("Instant Lockout:", "A single click locks the vault immediately and destroys the session token.")
    ]
    for h, desc in pv_steps:
        p_h = tf_v1.add_paragraph()
        p_h.text = f"\n• {h}"
        p_h.font.size = Pt(11)
        p_h.font.bold = True
        p_h.font.color.rgb = C_NAVY_DARK

        p_d = tf_v1.add_paragraph()
        p_d.text = f"  {desc}"
        p_d.font.size = Pt(10)
        p_d.font.color.rgb = C_TEXT_DARK

    # Right: Vault Keypad Visual Card
    x_vm = Inches(8.0)
    w_vm = Inches(4.533)
    c_vm = s9.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x_vm, y_split + Inches(0.3), w_vm, Inches(4.2))
    c_vm.fill.solid()
    c_vm.fill.fore_color.rgb = C_PURPLE_BG
    c_vm.line.color.rgb = C_PURPLE

    tb_vm = s9.shapes.add_textbox(x_vm + Inches(0.3), y_split + Inches(0.5), w_vm - Inches(0.6), Inches(3.8))
    tf_vm = tb_vm.text_frame
    tf_vm.word_wrap = True

    p_vh = tf_vm.paragraphs[0]
    p_vh.text = "PRIVATE SECURITY VAULT"
    p_vh.font.size = Pt(14)
    p_vh.font.bold = True
    p_vh.font.color.rgb = C_PURPLE
    p_vh.alignment = PP_ALIGN.CENTER

    p_vs = tf_vm.add_paragraph()
    p_vs.text = "\nEnter secret 4-digit PIN to access locked confidential documents.\n"
    p_vs.font.size = Pt(11)
    p_vs.font.color.rgb = C_TEXT_MUTED
    p_vs.alignment = PP_ALIGN.CENTER

    p_dots = tf_vm.add_paragraph()
    p_dots.text = "●    ●    ●    ●\n"
    p_dots.font.size = Pt(24)
    p_dots.font.bold = True
    p_dots.font.color.rgb = C_PURPLE
    p_dots.alignment = PP_ALIGN.CENTER

    p_btn = tf_vm.add_paragraph()
    p_btn.text = "[ Unlock Private Vault ]\n"
    p_btn.font.size = Pt(12)
    p_btn.font.bold = True
    p_btn.font.color.rgb = C_PURPLE
    p_btn.alignment = PP_ALIGN.CENTER

    p_sec = tf_vm.add_paragraph()
    p_sec.text = "Protected by Bcrypt & Supabase Row-Level Security"
    p_sec.font.size = Pt(10)
    p_sec.font.bold = True
    p_sec.font.color.rgb = C_GREEN_PRIMARY
    p_sec.alignment = PP_ALIGN.CENTER

    # =========================================================================
    # SLIDE 10: GEMINI AI & OCR BACKEND (Speaker: Md. Mirazul Alam)
    # =========================================================================
    s10 = prs.slides.add_slide(blank_layout)
    set_background(s10, C_WHITE)
    add_slide_header(s10, "Machine Learning", "Gemini AI & OCR Backend Pipelines", "Md. Mirazul Alam", 10)

    ai_pipelines = [
        ("1. DOCX to PDF Pipeline", C_RED_TEXT, C_RED_BG, [
            ("Mammoth & PDF-Lib:", "Extracts raw text from Word documents and constructs standard A4 PDFs."),
            ("Bengali Font Embed:", "Embedded the Unicode Kalpurush font directly into pdf-lib to prevent broken Bengali characters."),
            ("Automatic Sizing:", "Auto-calculates margins, line heights, and page breaks dynamically.")
        ]),
        ("2. OCR Text Extraction", C_BLUE_PRIMARY, C_BLUE_BG, [
            ("Photo Text Extraction:", "Reads editable text from whiteboard photos, lecture slides, and receipts."),
            ("Local Tesseract.js:", "Primary fast local processing using eng.traineddata."),
            ("Gemini Vision Fallback:", "Automatically falls back to Gemini Multimodal Vision API if a scan is dark or low resolution.")
        ]),
        ("3. Gemini AI Summarizer", C_GREEN_PRIMARY, C_GREEN_BG, [
            ("Long Document Analysis:", "Google Gemini reads 20+ page academic research papers and reports."),
            ("Structured 3-Part Output:", "Generates: 1. Main Topic, 2. Key Bullet Points, 3. Conclusion."),
            ("Massive Time Savings:", "Reduces hours of reading to a clean 3-second summary.")
        ])
    ]

    for i, (atitle, acolor, abg, apoints) in enumerate(ai_pipelines):
        x = Inches(0.8 + i * (3.64 + 0.4))
        c = s10.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y_card, col_w, h_card)
        c.fill.solid()
        c.fill.fore_color.rgb = C_CARD_BG
        c.line.color.rgb = C_BORDER

        hb = s10.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + Inches(0.15), y_card + Inches(0.2), col_w - Inches(0.3), Inches(0.55))
        hb.fill.solid()
        hb.fill.fore_color.rgb = abg
        hb.line.color.rgb = C_BORDER
        p_hb = hb.text_frame.paragraphs[0]
        p_hb.text = atitle
        p_hb.font.size = Pt(12)
        p_hb.font.bold = True
        p_hb.font.color.rgb = acolor
        p_hb.alignment = PP_ALIGN.CENTER

        tb = s10.shapes.add_textbox(x + Inches(0.15), y_card + Inches(0.90), col_w - Inches(0.3), Inches(4.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for bold_txt, norm_txt in apoints:
            p = tf.add_paragraph() if tf.paragraphs[0].text else tf.paragraphs[0]
            p.text = f"• {bold_txt}"
            p.font.size = Pt(10.5)
            p.font.bold = True
            p.font.color.rgb = C_NAVY_DARK

            pd = tf.add_paragraph()
            pd.text = f"  {norm_txt}\n"
            pd.font.size = Pt(10)
            pd.font.color.rgb = C_TEXT_MUTED

    # =========================================================================
    # SLIDE 11: COMPLETE TECH STACK (Speaker: Md. Mirazul Alam)
    # =========================================================================
    s11 = prs.slides.add_slide(blank_layout)
    set_background(s11, C_WHITE)
    add_slide_header(s11, "Implementation", "Complete Technology Stack", "Md. Mirazul Alam", 11)

    tech_stack = [
        ("Frontend UI", C_BLUE_PRIMARY, C_BLUE_BG, [
            ("HTML5 & Vanilla CSS3:", "Clean, lightweight styling without heavyweight UI frameworks."),
            ("Pure JavaScript:", "Modern ES6+ asynchronous DOM rendering."),
            ("FontAwesome Vector Icons:", "Clean vector icons for all file categories."),
            ("QRCode.js & JSZip:", "In-browser QR code generation and zip compression.")
        ]),
        ("Backend Server", C_GREEN_PRIMARY, C_GREEN_BG, [
            ("Node.js Runtime:", "Fast, non-blocking asynchronous event loop."),
            ("Express.js:", "RESTful endpoint routing and session management."),
            ("Express-Rate-Limit:", "API rate limiting defending against spam attacks."),
            ("Multer Memory Parser:", "Streaming file uploads directly to cloud storage.")
        ]),
        ("Cloud & Database", RGBColor(13, 148, 136), RGBColor(240, 253, 250), [
            ("Supabase PostgreSQL:", "Relational database with Row-Level Security."),
            ("Cloud Object Storage:", "Honest 1 GB free-tier storage with 50 MB file limits."),
            ("Bcryptjs Encryption:", "Salted password and 4-digit PIN hashing."),
            ("JWT Session Security:", "Encrypted authentication session tokens.")
        ]),
        ("AI & Libraries", C_PURPLE, C_PURPLE_BG, [
            ("Google Gemini 3.0 API:", "Multimodal document intelligence and summarization."),
            ("Tesseract.js OCR:", "Local computer vision for image text extraction."),
            ("PDF-Lib & Fontkit:", "PDF generation with embedded font support."),
            ("Kalpurush Font:", "Unicode font embedding for Bengali language support.")
        ])
    ]

    for i, (stitle, scolor, sbg, spoints) in enumerate(tech_stack):
        x = Inches(0.8 + i * (2.7 + 0.31))
        c = s11.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y_card, col4_w, h_card)
        c.fill.solid()
        c.fill.fore_color.rgb = C_CARD_BG
        c.line.color.rgb = C_BORDER

        hb = s11.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x + Inches(0.12), y_card + Inches(0.2), col4_w - Inches(0.24), Inches(0.55))
        hb.fill.solid()
        hb.fill.fore_color.rgb = sbg
        hb.line.color.rgb = C_BORDER
        p_hb = hb.text_frame.paragraphs[0]
        p_hb.text = stitle
        p_hb.font.size = Pt(12)
        p_hb.font.bold = True
        p_hb.font.color.rgb = scolor
        p_hb.alignment = PP_ALIGN.CENTER

        tb = s11.shapes.add_textbox(x + Inches(0.12), y_card + Inches(0.9), col4_w - Inches(0.24), Inches(4.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for bold_txt, norm_txt in spoints:
            p = tf.add_paragraph() if tf.paragraphs[0].text else tf.paragraphs[0]
            p.text = f"• {bold_txt}"
            p.font.size = Pt(10)
            p.font.bold = True
            p.font.color.rgb = C_NAVY_DARK

            pd = tf.add_paragraph()
            pd.text = f"  {norm_txt}\n"
            pd.font.size = Pt(9.5)
            pd.font.color.rgb = C_TEXT_MUTED

    # =========================================================================
    # SLIDE 12: CONCLUSION, ROADMAP & QUESTIONS (Speakers: Both Mirazul & Ruma)
    # =========================================================================
    s12 = prs.slides.add_slide(blank_layout)
    set_background(s12, C_NAVY_DARK)

    # University Logo on Top Left
    if os.path.exists(logo_path):
        l_card12 = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.48), Inches(3.6), Inches(1.15))
        l_card12.fill.solid()
        l_card12.fill.fore_color.rgb = C_WHITE
        l_card12.line.fill.background()
        s12.shapes.add_picture(logo_path, Inches(0.95), Inches(0.56), width=Inches(3.3), height=Inches(3.3 / 3.2611))

    # University & Department text next to Logo
    tb_u12 = s12.shapes.add_textbox(Inches(4.6), Inches(0.50), Inches(5.0), Inches(1.15))
    tf_u12 = tb_u12.text_frame
    tf_u12.word_wrap = True
    pu1 = tf_u12.paragraphs[0]
    pu1.text = "NORTHERN UNIVERSITY BANGLADESH"
    pu1.font.size = Pt(15)
    pu1.font.bold = True
    pu1.font.color.rgb = C_WHITE

    pu2 = tf_u12.add_paragraph()
    pu2.text = "Department of Computer Science & Engineering"
    pu2.font.size = Pt(11.5)
    pu2.font.bold = True
    pu2.font.color.rgb = RGBColor(56, 189, 248)

    pu3 = tf_u12.add_paragraph()
    pu3.text = "Academic Project Defense • Conclusion & Q/A Session"
    pu3.font.size = Pt(9.5)
    pu3.font.color.rgb = RGBColor(148, 163, 184)

    # Speaker Badge on Top Right
    sb12 = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.0), Inches(0.52), Inches(3.533), Inches(0.44))
    sb12.fill.solid()
    sb12.fill.fore_color.rgb = RGBColor(20, 83, 45)
    sb12.line.color.rgb = RGBColor(74, 222, 128)
    tf_sb12 = sb12.text_frame
    tf_sb12.vertical_anchor = MSO_ANCHOR.MIDDLE
    p_sb12 = tf_sb12.paragraphs[0]
    p_sb12.text = "Speakers: Mirazul Alam & Ruma Ety"
    p_sb12.font.size = Pt(10.5)
    p_sb12.font.bold = True
    p_sb12.font.color.rgb = RGBColor(220, 252, 231)
    p_sb12.alignment = PP_ALIGN.CENTER

    # Thank You Title
    t12 = s12.shapes.add_textbox(Inches(0.8), Inches(1.80), Inches(11.733), Inches(0.8))
    p_t12 = t12.text_frame.paragraphs[0]
    p_t12.text = "Thank You!"
    p_t12.font.size = Pt(44)
    p_t12.font.bold = True
    p_t12.font.color.rgb = C_WHITE
    p_t12.alignment = PP_ALIGN.CENTER

    sub12 = s12.shapes.add_textbox(Inches(1.5), Inches(2.60), Inches(10.333), Inches(0.55))
    p_sub12 = sub12.text_frame.paragraphs[0]
    p_sub12.text = "Pocket Drive delivers a secure, intelligent, and user-friendly cloud storage experience for Northern University Bangladesh."
    p_sub12.font.size = Pt(13)
    p_sub12.font.color.rgb = RGBColor(203, 213, 225)
    p_sub12.alignment = PP_ALIGN.CENTER

    # 2 Summary Cards (Roadmap & Gratitude)
    y_b12 = Inches(3.30)
    w_b12 = Inches(5.66)
    h_b12 = Inches(2.15)

    # Left: Future Roadmap
    cb1 = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), y_b12, w_b12, h_b12)
    cb1.fill.solid()
    cb1.fill.fore_color.rgb = C_NAVY_CARD
    cb1.line.color.rgb = RGBColor(56, 189, 248)

    tb_cb1 = s12.shapes.add_textbox(Inches(1.05), y_b12 + Inches(0.12), w_b12 - Inches(0.5), h_b12 - Inches(0.24))
    tf_cb1 = tb_cb1.text_frame
    tf_cb1.word_wrap = True
    p_c1h = tf_cb1.paragraphs[0]
    p_c1h.text = "FUTURE ROADMAP"
    p_c1h.font.size = Pt(11)
    p_c1h.font.bold = True
    p_c1h.font.color.rgb = RGBColor(56, 189, 248)

    rm_items = [
        "Native Mobile Applications for Android & iOS devices.",
        "Real-time collaborative document editing inside the drive.",
        "End-to-End client-side file encryption (E2EE) for maximum privacy."
    ]
    for rmi in rm_items:
        p = tf_cb1.add_paragraph()
        p.text = f"• {rmi}"
        p.font.size = Pt(10.5)
        p.font.color.rgb = C_WHITE

    # Right: Supervisor Gratitude
    cb2 = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.86), y_b12, w_b12, h_b12)
    cb2.fill.solid()
    cb2.fill.fore_color.rgb = C_NAVY_CARD
    cb2.line.color.rgb = RGBColor(74, 222, 128)

    tb_cb2 = s12.shapes.add_textbox(Inches(7.11), y_b12 + Inches(0.12), w_b12 - Inches(0.5), h_b12 - Inches(0.24))
    tf_cb2 = tb_cb2.text_frame
    tf_cb2.word_wrap = True
    p_c2h = tf_cb2.paragraphs[0]
    p_c2h.text = "SPECIAL GRATITUDE"
    p_c2h.font.size = Pt(11)
    p_c2h.font.bold = True
    p_c2h.font.color.rgb = RGBColor(74, 222, 128)

    p_c2s = tf_cb2.add_paragraph()
    p_c2s.text = "Supervisor: Malyha Bintha Mabud"
    p_c2s.font.size = Pt(13)
    p_c2s.font.bold = True
    p_c2s.font.color.rgb = C_WHITE

    p_c2d = tf_cb2.add_paragraph()
    p_c2d.text = "Lecturer, Department of Computer Science & Engineering"
    p_c2d.font.size = Pt(10.5)
    p_c2d.font.color.rgb = RGBColor(203, 213, 225)

    p_c2u = tf_cb2.add_paragraph()
    p_c2u.text = "Northern University Bangladesh"
    p_c2u.font.size = Pt(10.5)
    p_c2u.font.bold = True
    p_c2u.font.color.rgb = RGBColor(96, 165, 250)

    # Question & Answer Banner (Polite question: "Do You Have Any Questions?")
    qa_card = s12.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.8), Inches(5.65), Inches(9.733), Inches(1.20))
    qa_card.fill.solid()
    qa_card.fill.fore_color.rgb = RGBColor(20, 83, 45)
    qa_card.line.color.rgb = RGBColor(74, 222, 128)

    tb_qa = s12.shapes.add_textbox(Inches(2.0), Inches(5.72), Inches(9.333), Inches(1.05))
    tf_qa = tb_qa.text_frame
    tf_qa.word_wrap = True

    p_qah = tf_qa.paragraphs[0]
    p_qah.text = "Do You Have Any Questions?"
    p_qah.font.size = Pt(18)
    p_qah.font.bold = True
    p_qah.font.color.rgb = C_WHITE
    p_qah.alignment = PP_ALIGN.CENTER

    p_qas = tf_qa.add_paragraph()
    p_qas.text = "Respected teachers and supervisor, we warmly welcome your questions, suggestions, and feedback."
    p_qas.font.size = Pt(11.5)
    p_qas.font.color.rgb = RGBColor(220, 252, 231)
    p_qas.alignment = PP_ALIGN.CENTER

    p_pres = tf_qa.add_paragraph()
    p_pres.text = "Presented by: Md. Mirazul Alam (Lead Developer) & Ruma Ahmed Ety (Documentation & Testing Assistant)"
    p_pres.font.size = Pt(9.5)
    p_pres.font.color.rgb = RGBColor(187, 247, 208)
    p_pres.alignment = PP_ALIGN.CENTER

    desktop_path = r"C:\Users\Miraz\Desktop\Pocket_Drive_Presentation.pptx"
    prs.save(desktop_path)
    print("SUCCESS: Generated academic PPTX strictly at Desktop:")
    print(f"-> {desktop_path}")

if __name__ == "__main__":
    build_presentation()
