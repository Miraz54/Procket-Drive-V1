for path in ['presentation.html', 'public/presentation.html']:
    with open(path, 'r', encoding='utf-8') as f:
        c = f.read()
    c = c.replace('🎙️ ', '')
    c = c.replace('🚀 ', '')
    c = c.replace('🎓 ', '')
    c = c.replace('✨ ', '')
    c = c.replace('Questions & Answers (Q&A) Session', 'Do You Have Any Questions?<br><span style="font-size:0.85rem; font-weight:400; color:#bbf7d0;">We warmly welcome your questions, suggestions, and feedback.</span>')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c)
print('Updated HTML files successfully.')
