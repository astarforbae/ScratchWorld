"""
Utility functions for the Scratch GUI Agent API.
"""
from playwright.async_api import ElementHandle


async def get_element_text_robust(element: ElementHandle) -> str:
    """鲁棒的文本提取，支持HTML和SVG元素"""
    if not element:
        return ""

    text_methods = [
        # 方法1：HTML元素的inner_text
        lambda: element.inner_text(),
        # 方法2：SVG元素的text_content
        lambda: element.text_content(),
        # 方法3：获取aria-label属性
        lambda: element.get_attribute('aria-label'),
        # 方法4：获取title属性
        lambda: element.get_attribute('title'),
        # 方法5：获取data-original-title属性
        lambda: element.get_attribute('data-original-title'),
        # 方法6：使用JavaScript获取文本内容
        lambda: element.evaluate('el => el.textContent || el.innerText || ""')
    ]

    for method in text_methods:
        try:
            result = await method()
            if result and result.strip():
                return result.strip()
        except Exception:
            continue
    return ""


def is_element_in_viewport(box: dict, viewport_width: int, viewport_height: int) -> bool:
    """
    检查元素是否在视口范围内

    参数:
    - box: 元素的边界框信息
    - viewport_width: 视口宽度
    - viewport_height: 视口高度

    返回:
    - True: 元素在视口内或与视口有交集
    - False: 元素完全在视口外
    """
    if not box:
        return False

    x = box["x"]
    y = box["y"]
    width = box["width"]
    height = box["height"]

    # 元素的右边界和下边界
    right = x + width
    bottom = y + height

    # 检查元素是否完全在视口外
    # 如果元素完全在左侧、右侧、上方或下方，则认为在视口外
    if (right <= 0 or          # 完全在左侧
        x >= viewport_width or # 完全在右侧
        bottom <= 0 or         # 完全在上方
        y >= viewport_height): # 完全在下方
        return False

    return True
