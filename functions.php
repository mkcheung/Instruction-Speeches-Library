<?php

function redirect_to($newLoc = null){
	if($newLoc != null){
		header("Location: $newLoc");
		exit;
	}
}

?>