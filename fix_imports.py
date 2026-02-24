import os

def replace_imports_in_dir(directory):
    target = "@siimpl/siimpli-graph-it-core"
    replacement = "@siimpli/graph-it-core"
    
    print(f"Scanning {directory}...")
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.js', '.jsx')):
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if target in content:
                        print(f"Updating {path}")
                        new_content = content.replace(target, replacement)
                        with open(path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                except Exception as e:
                    print(f"Error processing {path}: {e}")

if __name__ == "__main__":
    # Hardcoded absolute paths to the other repos
    replace_imports_in_dir(r"c:\Users\haris\Work\Siim2025\mine_analytics\script_manager\src")
    replace_imports_in_dir(r"c:\Users\haris\Work\Siim2025\siimpli-graph-it-copy\src")
