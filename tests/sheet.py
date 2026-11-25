# contact sheet: python3 tests/sheet.py OUT.png COLS CELLW CELLH files...
import sys
from PIL import Image
out, cols, w, h, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5:]
ims = [Image.open(f).convert('RGB').resize((w, h)) for f in files]
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * w, rows * h))
for i, im in enumerate(ims): S.paste(im, ((i % cols) * w, (i // cols) * h))
S.save(out)
