import sys
import os
import pymupdf4llm

def convert_pdf_to_md(pdf_path, output_dir=None):
    if not os.path.isfile(pdf_path):
        print(f"Error: File '{pdf_path}' not found.")
        return

    print(f"Converting '{pdf_path}' to Markdown...")

    try:
        # Convert the PDF to Markdown
        md_text = pymupdf4llm.to_markdown(pdf_path)

        # Determine output file path
        base_name = os.path.basename(pdf_path)
        name_without_ext = os.path.splitext(base_name)[0]

        if output_dir is None:
            output_dir = os.path.dirname(pdf_path)

        output_path = os.path.join(output_dir, f"{name_without_ext}.md")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md_text)

        print(f"Successfully saved Markdown to: {output_path}")

    except Exception as e:
        print(f"An error occurred during conversion: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pdf_to_md.py <path_to_pdf> [output_directory]")
        sys.exit(1)

    pdf_file = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else None

    convert_pdf_to_md(pdf_file, out_dir)
