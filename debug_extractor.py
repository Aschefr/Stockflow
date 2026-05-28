import sys
sys.stdout.reconfigure(encoding='utf-8')

with open("scratch_kbb.html", "r", encoding="utf-8") as f:
    text = f.read()

chars = list(text)
matches = []
i = 0
while i < len(chars):
    if chars[i].isdigit():
        start = i
        while i < len(chars) and (chars[i].isdigit() or chars[i] == '.' or chars[i] == ','):
            i += 1
        chunk = "".join(chars[start:i])
        trimmed = chunk.strip()
        if trimmed.endswith('.') or trimmed.endswith(','):
            trimmed = trimmed[:-1]
        dot_count = sum(1 for c in trimmed if c in ('.', ','))
        if dot_count == 1:
            cleaned = trimmed.replace(',', '.')
            try:
                val = float(cleaned)
                start_sub = max(0, start - 50)
                end_sub = min(len(chars), i + 50)
                context_str = "".join(chars[start_sub:end_sub]).lower()
                has_ht = "ht" in context_str
                has_unit = any(u in context_str for u in ("unit", "unitaire", "unité", "unité*"))
                matches.append((val, has_ht, has_unit, context_str))
            except ValueError:
                pass
    else:
        i += 1

with open("debug_output.txt", "w", encoding="utf-8") as out:
    out.write("--- ALL MATCHES ---\n")
    for val, has_ht, has_unit, context in matches:
        out.write(f"Val: {val}, HT: {has_ht}, Unit: {has_unit}\n")
        out.write(f"Context: {repr(context)}\n")
        out.write("-" * 40 + "\n")
