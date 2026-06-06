import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

def is_valid(url, base):
    # Only follow URLs that start with the base.
    return url.startswith(base)

def extract_text(soup):
    parts = []
    # Get page title.
    if soup.title:
        parts.append("Title: " + soup.title.get_text(strip=True))
    # Get header text (h1-h6).
    for header in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        text = header.get_text(strip=True)
        if text:
            parts.append("Header: " + text)
    # Get button text.
    for button in soup.find_all("button"):
        text = button.get_text(strip=True)
        if text:
            parts.append("Button: " + text)
    # Get all visible text from the page.
    main_text = soup.get_text(separator="\n", strip=True)
    parts.append("Content:\n" + main_text)
    return "\n".join(parts)

def dfs(url, base, visited, out_file, link_text=None):
    if url in visited:
        return
    visited.add(url)
    print(f"Scraping: {url}")
    
    try:
        res = requests.get(url)
        if res.status_code != 200:
            print(f"Skipping {url} (status: {res.status_code})")
            return
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return
    
    header_line = f"Link Text: {link_text}" if link_text else f"URL: {url}"
    
    # Parse HTML and remove scripts/styles.
    soup = BeautifulSoup(res.text, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    
    # Extract just the text with annotations.
    page_text = extract_text(soup)
    
    with open(out_file, "a", encoding="utf-8") as f:
        f.write(header_line + "\n")
        f.write(page_text)
        f.write("\n" + "="*80 + "\n")
    
    for a in soup.find_all("a", href=True):
        child_url = urljoin(url, a['href'])
        if is_valid(child_url, base) and child_url not in visited:
            dfs(child_url, base, visited, out_file, link_text=a.get_text(strip=True))

if __name__ == "__main__":
    root_url = "https://solana.com/docs"  # Replace with your starting URL.
    output_file = "output.txt"
    open(output_file, "w", encoding="utf-8").close()  # Clear output file.

    dfs(root_url, root_url, set(), output_file)
