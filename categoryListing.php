<?php
require_once("database.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("category.php");
require_once("function.php");
include_once("header.php");



if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

$categories = Category::find_all();

	echo("<div class=\"span7\">");
	echo "<table class=\"table\">";
	echo "<thead>";
	echo "<tr>";
	echo "<th>Speech Categories:";
	echo "</th>";
	echo "</tr>";
	echo "<tr>";
	echo "<th>Category</th>";
	echo "<th>Description</th>";
	echo "<th>Actions</th>" ;
	echo "</tr>";
	echo "</thead>";
	echo "<tbody>";
	if($categories){
		foreach($categories as $category){
			echo "<tr>";
			echo "<td>" . $category->category_title . "</td>";
			echo "<td>" . $category->category_description . "</td>";
			echo "<td><a id=\"editCategory-" . $category->id . "\" href=\"editCategory.php?categoryId=" . $category->id . "\"><button type=\"button\" class=\"btn btn-warning\">Edit</button></a>" . ' ' . 
			     "<a id=\"deleteCategory-" . $category->id . "\" href=\"deleteCategory.php?categoryId=" . $category->id . "\"><button type=\"button\" class=\"btn btn-danger\">Delete</button>". "</td>";
			echo "</tr>";
		}
	}
	echo "</tbody>";
	echo "</table>";
	echo "</div>";

include_once("footer.php");
?>
<script>
	$("#categoryListingBlock").unbind();
	$("#categoryListingBlock").on('click', 'a[id*="editCategory"]',function(e){
		e.preventDefault();
		e.stopPropagation();
		//alert('17');

		id = $(this).attr('id');
		categoryIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		$('#addEditCategoriesBlock').load('editCategory.php', {categoryId:categoryIdValue});

	});


	$('#categoryListingBlock').on("click",'a[id*="deleteCategory"]', function(e){
		e.preventDefault();
		e.stopPropagation();

		//alert('delete category');

		id = $(this).attr('id');
		categoryIdValue = id.substr(id.lastIndexOf('-')+1,id.length);
		deleteCategoryData(categoryIdValue);
	});

	function deleteCategoryData(categoryIdValue){
		$.ajax({
			type:'POST',
			url: 'categoryDelete.php',
			data:{categoryid:categoryIdValue},
			cache: false,
			timeout:7000,
			processData:true,
			success: function(data){
				$('div[class="alert alert-error"]').remove();
					$('div[class="alert alert-success"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-success">Speech Category deleted!</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
				$("#settingsControls").load("categoryALE.php");

			},
			error: function(XMLHttpRequest, textStatus, errorThrown){
				$('#registerErrorMessages div[class="alert alert-error"]').remove();
				$("#registerErrorMessages").append('<div class="alert alert-error">Speech Category could not be deleted.</div>');
				$("#registerErrorMessages").removeAttr('style');
				$("#registerErrorMessages").fadeOut(2000);
			},
			complete: function(XMLHttpRequest, status){
				$('form[id="categorySubmit"]')[0].reset();
			}
		});
	};
</script>