"""OpenCV appearance measurements; thresholds are heuristics, not semantic confidence."""

import cv2
import numpy as np

from .contracts import Image, Quality


def measure_quality(frame: Image) -> Quality:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    background = cv2.GaussianBlur(gray, (0, 0), 21)
    normalized = cv2.divide(gray, np.maximum(background, 1), scale=240)
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = ((normalized < 195) | ((hsv[:, :, 1] > 95) & (hsv[:, :, 2] < 250))).astype(
        np.uint8
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(count, dtype=np.uint8)
    if count > 1:
        keep[1:] = (stats[1:, cv2.CC_STAT_AREA] >= 5).astype(np.uint8)
    density = float(keep[labels].mean())
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean())
    dark, highlight = float(np.mean(gray < 30)), float(np.mean(gray > 253))
    textureless = density < 0.0005
    concerns: list[str] = []
    if brightness < 45 or dark > 0.65:
        concerns.append("too_dark")
    if sharpness < 25 and not textureless:
        concerns.append("possible_blur")
    if highlight > 0.98 and textureless:
        concerns.append("clipped_and_textureless")
    if textureless:
        concerns.append("focus_unknown")
    return Quality(
        sharpness, brightness, dark, highlight, density, textureless, tuple(concerns)
    )


def enhance(frame: Image) -> Image:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    light, a, b = cv2.split(lab)
    light = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8)).apply(light)
    return cv2.cvtColor(cv2.merge((light, a, b)), cv2.COLOR_LAB2BGR).astype(
        np.uint8, copy=False
    )
